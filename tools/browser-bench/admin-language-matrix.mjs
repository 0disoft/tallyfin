import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium, expect } from 'playwright/test';
import { ACTIVE_LOCALES } from '../../apps/admin/src/i18n/preference.ts';
import { adminLoginFixture } from './admin-login-fixture.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
let local,server,browser,page,directory,watchdog,stage='fixture',routeError=false;
const pageErrors=[],screenshots=[],matrix=[],fontChecks=[];
const catalog=async(locale,namespace)=>JSON.parse(await readFile(resolve(root,`apps/admin/locales/${locale}/${namespace}.json`),'utf8'));
const fontScripts={en:['Inter','Event analysis'],es:['Inter','Análisis'],fr:['Inter','Événements'],vi:['Inter','Tiếng Việt'],id:['Inter','Peristiwa'],ms:['Inter','Peristiwa'],ru:['Noto Sans','События'],ko:['Noto Sans KR','이벤트 분석'],zh:['Noto Sans SC','事件分析'],ja:['Noto Sans JP','イベント分析'],hi:['Noto Sans Devanagari','घटनाएँ'],th:['Noto Sans Thai','เหตุการณ์']};
try{
  await mkdir(resolve(root,'.tmp'),{recursive:true});directory=await mkdtemp(resolve(root,'.tmp/admin-language-matrix-'));
  local=await adminLoginFixture(directory,{profile:'goals'});
  watchdog=setTimeout(()=>{void browser?.close();},240000);
  server=await createServer({root:resolve(root,'apps/admin'),configFile:resolve(root,'apps/admin/vite.config.mjs'),envDir:false,envPrefix:[],cacheDir:resolve(directory,'vite-cache'),logLevel:'error',
    define:Object.fromEntries(Object.entries({VITE_OIDC_ISSUER:local.issuer,VITE_OIDC_CLIENT_ID:local.clientId,VITE_OIDC_SCOPE:'openid offline_access',VITE_OIDC_RESOURCE:local.resource,VITE_OIDC_ID_TOKEN_ALG:'RS256'}).map(([key,value])=>[`import.meta.env.${key}`,JSON.stringify(value)])),
    server:{host:'127.0.0.1',port:0,proxy:{'^/v1(?:/|\\?|$)':{target:new URL(await local.mf.ready).origin,changeOrigin:false}}}});
  await server.listen();const origin=`http://127.0.0.1:${server.httpServer.address().port}`;local.configure(origin);
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1024},serviceWorkers:'block'});
  await context.route('**/*',async route=>{try{await local.route(route);}catch{routeError=true;await route.abort().catch(()=>{});}});
  page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>pageErrors.push(error.message));
  const language=()=>page.locator('.locale-control select');
  const switchLocale=async locale=>{await language().selectOption(locale);await expect(page.locator('html')).toHaveAttribute('lang',locale);await expect(language()).toBeEnabled();};
  const nav=()=>page.locator('.nav-list button');
  const capture=async(name)=>{
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:1024});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name}: overflow at ${width}px`);
      if(width===390){const path=resolve(directory,`${name}-${width}.png`);await page.screenshot({path,fullPage:true});screenshots.push(path);}
    }
    await page.setViewportSize({width:1440,height:1024});
  };
  stage='login';await page.goto(origin);await page.getByRole('button',{name:'관리자 로그인',exact:true}).click();
  await page.getByRole('heading',{name:'등록 이벤트 집계',exact:true}).waitFor();await page.getByRole('combobox',{name:'프로젝트 선택',exact:true}).selectOption('sembom');
  assert.deepEqual((await language().locator('option').evaluateAll(options=>options.map(option=>option.value))).sort(),[...ACTIVE_LOCALES].sort());
  stage='event-matrix';await nav().nth(1).click();await page.getByRole('button',{name:'tool_view',exact:true}).click();
  await expect(page.locator('.event-detail .recharts-wrapper')).toBeVisible();await page.waitForLoadState('networkidle');
  const event=await page.locator('.event-explorer-item[aria-pressed=true]').getAttribute('aria-label');
  let reads=local.counts.apiReads,baselineCsv;
  for(const locale of ACTIVE_LOCALES){
    stage=`events-${locale}`;await switchLocale(locale);const labels=await catalog(locale,'admin');
    await expect(page.locator('.page-header h1')).toHaveText(labels.navEvents);
    assert.equal(await page.locator('.event-explorer-item[aria-pressed=true]').getAttribute('aria-label'),event);
    assert.equal(local.counts.apiReads,reads,stage+': locale repeated API reads');
    const download=page.waitForEvent('download');await page.locator('.csv-export button').click();
    const csv=await readFile(await(await download).path(),'utf8');baselineCsv??=csv;assert.equal(csv,baselineCsv);
    if(fontScripts[locale]){
      const [family,text]=fontScripts[locale];
      const loaded=await page.evaluate(async({family,text})=>{const faces=await document.fonts.load(`400 16px "${family}"`,text);return {family:getComputedStyle(document.body).fontFamily,count:faces.length,ready:faces.every(face=>face.status==='loaded')};},{family,text});
      assert.equal(loaded.family.split(',')[0].replaceAll('"',''),family,JSON.stringify({locale,...loaded}));
      assert.ok(loaded.count>0&&loaded.ready,JSON.stringify({locale,...loaded}));fontChecks.push(locale);
      if(family==='Inter'){
        assert.match(await page.locator('.event-detail .recharts-cartesian-axis-tick-value').first().evaluate(element=>getComputedStyle(element).fontVariantNumeric),/tabular-nums/);
        const digits=await page.locator('.event-explorer-value').first().evaluate(async element=>{
          await document.fonts.ready;
          const sample=document.createElement('span');element.append(sample);
          try{
            const widths=[...'0123456789'].map(digit=>{sample.textContent=digit;return sample.getBoundingClientRect().width;});
            return {variant:getComputedStyle(sample).fontVariantNumeric,spread:Math.max(...widths)-Math.min(...widths)};
          }finally{sample.remove();}
        });
        assert.match(digits.variant,/tabular-nums/);assert.ok(digits.spread<0.05,JSON.stringify({locale,...digits}));
      }
    }
    await capture(stage);matrix.push(stage);
  }
  stage='goal-matrix';await nav().nth(2).click();await expect(page.locator('.goal-inspector')).toBeVisible();await page.waitForLoadState('networkidle');
  const goal=await page.locator('.goal-option[aria-pressed=true]').getAttribute('aria-label');reads=local.counts.apiReads;
  for(const locale of ACTIVE_LOCALES){
    stage=`goals-${locale}`;await switchLocale(locale);const labels=await catalog(locale,'admin');
    await expect(page.locator('.page-header h1')).toHaveText(labels.navGoals);
    assert.equal(await page.locator('.goal-option[aria-pressed=true]').getAttribute('aria-label'),goal);assert.equal(local.counts.apiReads,reads,stage);
    await capture(stage);matrix.push(stage);
  }
  stage='settings-matrix';await nav().nth(3).click();const name=page.locator('#settings-name'),schema=page.locator('#schema-draft');
  await expect(name).toBeEnabled();await expect(page.locator('.collection-diagnostics')).not.toHaveAttribute('aria-busy','true');
  await name.fill('');await page.locator('.project-settings-form button[type=submit]').click();await expect(name).toHaveAttribute('aria-invalid','true');
  await page.locator('#settings-tab-schema').click();await expect(schema).toBeEditable();const original=await schema.inputValue(),draft=original+'\n';await schema.fill(draft);
  await page.waitForLoadState('networkidle');reads=local.counts.apiReads;
  for(const locale of ACTIVE_LOCALES){
    stage=`settings-${locale}`;await switchLocale(locale);const labels=await catalog(locale,'admin'),messages=await catalog(locale,'messages'),settings=await catalog(locale,'settings');
    await expect(page.locator('.page-header h1')).toHaveText(labels.navSettings);await expect(name).toHaveValue('');await expect(schema).toHaveValue(draft);
    await expect(page.locator('#settings-name-error')).toHaveText(messages.projectNameInvalid);
    for(const [id,key]of Object.entries({project:'tabProject',diagnostics:'tabDiagnostics',schema:'tabSchema',sdk:'tabSdk',access:'tabAccess'}))await expect(page.locator(`#settings-tab-${id}`)).toHaveText(settings[key]);
    assert.equal(local.counts.apiReads,reads,stage+': locale repeated API reads');await capture(stage);matrix.push(stage);
    for(const panel of ['project','diagnostics','sdk','access']){
      await page.locator(`#settings-tab-${panel}`).click();
      await expect(page.locator('.settings-workspace > [role=tabpanel]:not([hidden])')).toHaveCount(1);
      await capture(`${stage}-${panel}`);
      assert.equal(local.counts.apiReads,reads,`${stage}-${panel}: tabs repeated API reads`);
    }
    await page.locator('#settings-tab-schema').click();
  }
  const restoredLocale=ACTIVE_LOCALES.includes('ja')?'ja':ACTIVE_LOCALES.at(-1);
  stage='saved-preference';await switchLocale(restoredLocale);
  // Verify restoration without carrying API credentials or dirty drafts across a reload.
  page.once('dialog',dialog=>dialog.accept());await page.reload();await expect(page.locator('html')).toHaveAttribute('lang',restoredLocale);
  const restored=await catalog(restoredLocale,'operations');await expect(page.getByRole('button',{name:restored.loginButton,exact:true})).toBeVisible();
  assert.equal(local.counts.authorizations,1);assert.equal(local.counts.apiWrites,0);assert.deepEqual(pageErrors,[]);assert.equal(routeError,false);
  const report={verified:true,locales:ACTIVE_LOCALES,matrix,fontChecks,screenshots,pageErrors,routeError,noLocaleApiReads:true,csvIdentical:true,draftsRetained:true,errorsRetranslated:true,preferenceRestored:true,...local.counts};
  await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({verified:true,evidence:directory,locales:ACTIVE_LOCALES.length,views:matrix.length,...local.counts}));
}catch(error){if(directory){await writeFile(resolve(directory,'failure.json'),JSON.stringify({stage,message:error.message,pageErrors,routeError}));await page?.screenshot({path:resolve(directory,'failure.png'),fullPage:true}).catch(()=>{});}console.error(JSON.stringify({verified:false,stage,message:error.message,evidence:directory}));process.exitCode=1;}
finally{clearTimeout(watchdog);await browser?.close();await server?.close();await local?.mf.dispose();}
