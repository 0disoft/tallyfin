import assert from 'node:assert/strict';

export async function answerConfirm(page, action, accept) {
  const dialog = page.waitForEvent('dialog', { timeout: 5000 }).then(async value => {
    assert.equal(value.type(), 'confirm');
    if (accept) await value.accept();
    else await value.dismiss();
  });
  await Promise.all([dialog, Promise.resolve().then(action)]);
}
