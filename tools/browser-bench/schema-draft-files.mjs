import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Exercises actual download bytes and FileReader through the live schema editor. */
export async function verifySchemaDraftFiles(page, local, directory, progress = () => {}) {
  const writes = local.counts.apiWrites;
  const draft = page.locator('#schema-draft'), target = page.locator('#schema-version');
  const privacy = page.getByRole('checkbox', { name: '정의와 허용 값에 개인정보·원시 입력값이 없음을 검토했어요.', exact: true });
  const save = async filename => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: '초안 파일 저장', exact: true }).click();
    const download = await pending;
    assert.equal(download.suggestedFilename(), 'tallyfin-onboarding-test-schema-draft.json');
    const path = resolve(directory, filename); await download.saveAs(path);
    return readFile(path, 'utf8');
  };
  const choose = text => page.locator('#schema-draft-file').setInputFiles({ name: 'draft.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  let dialogs = 0;
  const consent = async accept => {
    const dialog = await page.waitForEvent('dialog');
    dialogs++; assert.equal(dialog.type(), 'confirm'); assert.match(dialog.message(), /초안.*파일/);
    await (accept ? dialog.accept() : dialog.dismiss());
  };
  await page.locator('#schema-event-0-label').fill('Saved draft'); await target.fill('3');
  const savedDraft = await draft.inputValue(), saved = await save('schema-draft.json');
  assert.deepEqual(JSON.parse(saved), { format: 'tallyfin.schema-draft/v1', projectId: 'onboarding-test', targetVersion: '3', draftText: savedDraft });
  await target.fill('4'); await page.getByRole('button', { name: '정의 검증', exact: true }).click(); await privacy.check();
  const validatedWrites = local.counts.apiWrites;
  progress('validation-count'); assert.equal(validatedWrites, writes + 1);
  for (const [text, message] of [
    ['{', 'Tallyfin에서 저장한 초안 JSON 파일을 선택해 주세요.'],
    [JSON.stringify({ ...JSON.parse(saved), projectId: 'another-project' }), '현재 프로젝트에서 저장한 초안 파일을 선택해 주세요.'],
    [' '.repeat(128 * 1024 + 1), '초안 파일은 128KiB 이하로 선택해 주세요.'],
  ]) {
    progress(`rejected-${message.includes('128') ? 'size' : message.includes('현재') ? 'project' : 'json'}`);
    await choose(text); await page.getByRole('alert').filter({ hasText: message }).waitFor();
    assert.equal(await privacy.isChecked(), true); assert.equal(await target.inputValue(), '4');
  }
  progress('cancel'); const canceled = consent(false); await choose(saved); await canceled;
  assert.equal(dialogs, 1); assert.equal(await target.inputValue(), '4'); assert.equal(await privacy.isChecked(), true);
  progress('import'); const imported = consent(true); await choose(saved); await imported;
  await page.getByText('초안 파일을 불러왔어요. 버전과 정의를 검증하고 개인정보 검토를 다시 확인해 주세요.', { exact: true }).waitFor();
  assert.equal(await target.inputValue(), '3'); assert.equal(await draft.inputValue(), savedDraft);
  assert.equal(await privacy.isChecked(), false);
  assert.equal(await page.getByRole('button', { name: '새 버전 발행 (v3)', exact: true }).isDisabled(), true);
  assert.equal(await page.locator('#schema-draft-file').inputValue(), '');
  progress('screenshots'); await page.screenshot({ path: resolve(directory, 'schema-draft-files.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(directory, 'schema-draft-files-mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 1280, height: 900 });
  progress('unfinished'); await page.locator('.schema-json-editor > summary').click();
  await draft.fill('{unfinished 한글'); await target.fill('');
  const unfinished = await save('schema-draft-unfinished.json');
  await draft.fill('{}'); const restored = consent(true); await choose(unfinished); await restored;
  await page.waitForFunction(() => document.querySelector('#schema-draft')?.value === '{unfinished 한글');
  assert.equal(await draft.inputValue(), '{unfinished 한글'); assert.equal(await target.inputValue(), '');
  assert.equal(local.counts.apiWrites, validatedWrites);
  progress('restore'); page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'v1 불러오기', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#schema-event-0-label')?.disabled === false);
  await target.fill('2');
  assert.equal(await page.locator('#schema-event-0-label').inputValue(), 'Action complete');
  return { schemaDraftFiles: true, draftFileDialogs: dialogs, draftFileExtraWrites: local.counts.apiWrites - writes };
}
