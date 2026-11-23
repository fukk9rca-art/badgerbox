// End-to-end test of the two main screens (app.html, answers.html) against the fake model, no API key or cost.
// 1. start a fake server:  BADGERBOX_FAKE=1 PORT=3005 node tools/serve.mjs   (keys.json needs key 8008 with a high runsPerDay)
// 2. run:                  node tests/flow.test.cjs 3005 /tmp/bb-shots   (needs Playwright: npm i -D playwright)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const PORT = process.argv[2] || '3005';
const OUT = process.argv[3] || '/tmp/v2out';
const FIX = path.join(__dirname, 'fixtures');
const BASE = 'http://127.0.0.1:' + PORT + '/';
const HAS_VOICE = fs.existsSync(path.join(__dirname, '..', 'skills', 'my-voice', 'SKILL.md'));
fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('bb-key', '8008'); } catch (e) {} });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/fonts|ERR_TUNNEL|Failed to load resource/.test(m.text())) errs.push(m.text()); });

  // 1. typed run
  await p.goto(BASE + 'app.html');
  await p.waitForSelector('#bb-runs');
  ok(/runs today: \d+ of \d+/.test(await p.textContent('#bb-runs')), 'runs counter shows');
  ok(await p.isDisabled('#bb-run'), 'run is off with nothing in the box');
  await p.fill('#bb-in', 'Solve 3x + 7 = 22\nSolve 2x - 1 = 6');
  ok(await p.isDisabled('#bb-run'), 'run stays off until the agree box is ticked');
  await p.click('#bb-agree');
  ok(/run · uses 1/.test(await p.textContent('#bb-run')), 'run button shows the cost');
  await p.screenshot({ path: OUT + '/1-drop-filled.png' });
  const used0 = Number((await p.textContent('#bb-runs')).match(/(\d+) of/)[1]);
  await p.click('#bb-run');
  await p.waitForSelector('#bb-done', { timeout: 30000 });
  ok(/4 answers, 1 needs a look/.test(await p.textContent('#bb-done')), 'done line counts answers and flags: ' + await p.textContent('#bb-done'));
  await p.waitForFunction((u) => { const el = document.getElementById('bb-runs'); return el && Number((el.textContent.match(/(\d+) of/) || [])[1]) === u + 1; }, used0, { timeout: 5000 }).then(() => ok(true, 'one run charged'), () => ok(false, 'one run charged'));
  await p.click('#bb-see');
  await p.waitForSelector('#bb-head');

  // 2. answers screen
  ok(/4 answers\. 1 needs a look\./.test(await p.textContent('#bb-head')), 'headline: ' + await p.textContent('#bb-head'));
  const first = await p.getAttribute('.bb-q >> nth=0', 'data-n');
  ok(first === '2', 'flagged question is first (#' + first + ')');
  ok(await p.isVisible('.bb-flagbox'), 'flagged question is open with its review panel');
  await p.screenshot({ path: OUT + '/2-answers.png', fullPage: true });
  await p.click('.bb-flagbox >> text=it\'s right');
  ok(/all settled/.test(await p.textContent('#bb-head')), 'it\'s right settles it');
  await p.click('.bb-undo');
  ok(/1 needs a look/.test(await p.textContent('#bb-head')), 'undo brings the flag back');

  // edit answer on #1
  await p.click('.bb-q[data-n="1"] .bb-row');
  await p.click('.bb-q[data-n="1"] .bb-edit');
  await p.fill('#bb-edit-0', 'x = 6');
  await p.click('.bb-q[data-n="1"] .bb-save');
  ok((await p.textContent('.bb-q[data-n="1"] .bb-a')).trim() === 'x = 6', 'edited answer shows');
  ok(/you edited/.test(await p.textContent('.bb-q[data-n="1"] .bb-chip')), 'marked you edited');

  // chat change on #1
  await p.fill('#bb-ask-0', 'it should be x = 7');
  await p.click('.bb-q[data-n="1"] .bb-ask');
  await p.waitForSelector('.bb-q[data-n="1"] .bb-change', { timeout: 10000 });
  ok(/change it to x = 7/.test(await p.textContent('.bb-q[data-n="1"] .bb-change')), 'chat offers the change and waits');
  ok((await p.textContent('.bb-q[data-n="1"] .bb-a')).trim() === 'x = 6', 'nothing changes before confirming');
  await p.click('.bb-q[data-n="1"] .bb-change');
  ok((await p.textContent('.bb-q[data-n="1"] .bb-a')).trim() === 'x = 7', 'answer changed after confirming');
  ok(/changed in chat/.test(await p.textContent('.bb-q[data-n="1"] .bb-chip')), 'marked changed in chat');
  await p.screenshot({ path: OUT + '/3-chat-change.png', fullPage: true });

  // retry on #2
  await p.click('.bb-q[data-n="2"] .bb-row');
  await p.click('.bb-q[data-n="2"] .bb-retry');
  await p.waitForFunction(() => !/working it again/.test(document.body.textContent), null, { timeout: 15000 });
  ok(/x = 5/.test(await p.textContent('.bb-q[data-n="2"] .bb-a')), 'retry brought a new answer: ' + await p.textContent('.bb-q[data-n="2"] .bb-a'));

  // download with flags open
  await p.click('#bb-dl');
  ok(await p.isVisible('#bb-confirm'), 'download asks first while flags are open');
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.click('#bb-dl-anyway')]);
  const dlPath = OUT + '/' + dl.suggestedFilename();
  await dl.saveAs(dlPath);
  const head = fs.readFileSync(dlPath).slice(0, 5).toString();
  ok(head === '%PDF-', 'typed run downloads a clean answer PDF: ' + dl.suggestedFilename());

  // reload keeps fixes
  await p.reload();
  await p.waitForSelector('#bb-head');
  ok((await p.textContent('.bb-q[data-n="1"] .bb-a')).trim() === 'x = 7', 'fixes survive a reload');

  // past runs
  await p.goto(BASE + 'app.html#past');
  await p.waitForSelector('text=past runs');
  ok(/linear equations/.test(await p.textContent('body')), 'run is in past runs');

  // 3. picture run with a placed answer and drag
  await p.goto(BASE + 'app.html');
  await p.setInputFiles('#bb-file', path.join(FIX, 'worksheet.png'));
  await p.waitForFunction(() => /uses/.test(document.getElementById('bb-run').textContent), null, { timeout: 15000 });
  await p.click('#bb-run');
  await p.waitForSelector('#bb-done', { timeout: 60000 });
  await p.click('#bb-see');
  await p.waitForSelector('#bb-page img', { timeout: 15000 });
  await p.waitForTimeout(800);
  const nAns = await p.$$eval('.bb-ans', (els) => els.length);
  ok(nAns > 0, 'answers are drawn on the page preview (' + nAns + ')');
  await p.screenshot({ path: OUT + '/4-picture.png', fullPage: true });
  const a0 = await p.$('.bb-ans');
  const bx = await a0.boundingBox();
  const i0 = await a0.getAttribute('data-i');
  await p.mouse.move(bx.x + 5, bx.y + 5); await p.mouse.down(); await p.mouse.move(bx.x + 60, bx.y + 80, { steps: 6 }); await p.mouse.up();
  const bx2 = await (await p.$('.bb-ans[data-i="' + i0 + '"]')).boundingBox();
  ok(Math.abs(bx2.y - bx.y) > 30, 'answer can be dragged');
  await p.reload(); await p.waitForSelector('#bb-page img'); await p.waitForTimeout(800);
  const bx3 = await (await p.$('.bb-ans[data-i="' + i0 + '"]')).boundingBox();
  ok(Math.abs(bx3.y - bx2.y) < 4, 'dragged spot survives a reload');
  const [dl2] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.click('#bb-dl').then(async () => { if (await p.isVisible('#bb-confirm')) await p.click('#bb-dl-anyway'); })]);
  ok(/\.png$|\.pdf$/.test(dl2.suggestedFilename()), 'picture run downloads the page: ' + dl2.suggestedFilename());

  // 4. extension hand-over
  await p.goto(BASE + 'app.html');
  await p.waitForFunction(() => document.documentElement.dataset.bbReady === '1');
  const png = 'data:image/png;base64,' + fs.readFileSync(path.join(FIX, 'worksheet.png')).toString('base64');
  await p.evaluate((u) => window.postMessage({ bbExt: { files: [{ name: 'classroom screenshot.png', url: u, type: 'image/png', ref: true }, { name: 'worksheet.png', url: u, type: 'image/png' }], text: 'do problems 1 to 4', context: [{ name: 'video transcript', text: 'today we solve equations '.repeat(50) }] } }, location.origin), png);
  await p.waitForFunction(() => document.querySelectorAll('.bb-filerow').length === 2, null, { timeout: 10000 });
  const body = await p.textContent('body');
  ok(/just for reference/.test(body) && /do this one/.test(body), 'extension files arrive with their roles');
  ok(/teacher's instructions/.test(body) && /video transcript/.test(body), 'instructions and transcript arrive as context');
  await p.waitForFunction(() => /uses/.test(document.getElementById('bb-run').textContent), null, { timeout: 15000 });
  ok(/uses 1/.test(await p.textContent('#bb-run')), 'cost counts the reference file at half: ' + await p.textContent('#bb-run'));
  await p.screenshot({ path: OUT + '/5-extension.png' });

  // 5. phone
  const ph = await ctx.newPage();
  await ph.setViewportSize({ width: 390, height: 844 });
  await ph.goto(BASE + 'app.html');
  await ph.waitForSelector('#bb-run');
  const rb = await (await ph.$('#bb-run')).boundingBox();
  ok(rb.y + rb.height <= 844, 'run button is on the first phone screen (bottom ' + Math.round(rb.y + rb.height) + ')');
  const sw = await ph.evaluate(() => document.documentElement.scrollWidth);
  ok(sw <= 390, 'no sideways scroll on the phone drop screen (' + sw + ')');
  await ph.screenshot({ path: OUT + '/6-phone-drop.png' });
  await ph.goto(BASE + 'answers.html');
  await ph.waitForSelector('#bb-head');
  const sw2 = await ph.evaluate(() => document.documentElement.scrollWidth);
  ok(sw2 <= 390, 'no sideways scroll on the phone answers screen (' + sw2 + ')');
  await ph.screenshot({ path: OUT + '/7-phone-answers.png', fullPage: true });

  // 6. sample
  await p.goto(BASE + 'app.html');
  await p.click('text=see a sample run');
  await p.waitForSelector('#bb-head');
  ok(/sample run/.test(await p.textContent('body')) && /7 answers/.test(await p.textContent('#bb-head')), 'sample run opens');


  // 7. classes, settings, to do, my voice, tl;dr
  await p.goto(BASE + 'app.html#classes');
  await p.click('#bb-add-class');
  await p.fill('#bb-cls-name-0', 'algebra 1');
  await p.fill('#bb-cls-rules-0', 'show every step\nleave answers as fractions');
  const sets = await p.evaluate(() => JSON.parse(localStorage.getItem('bb-settings') || '{}'));
  ok(sets.classes && sets.classes[0] && sets.classes[0].name === 'algebra 1' && sets.classes[0].rules.length === 2, 'a class and its rules are saved');
  await p.goto(BASE + 'app.html#settings');
  await p.fill('#bb-voice-sample', 'i think the book is good because the main guy changes a lot by the end.');
  ok(/16 words saved/.test(await p.textContent('body')), 'writing sample is saved');
  await p.goto(BASE + 'app.html#todo');
  await p.fill('#bb-todo-in', 'chem lab report');
  await p.press('#bb-todo-in', 'Enter');
  ok(await p.$$eval('.bb-todo', (els) => els.length) === 1, 'to do item added');
  await p.click('.bb-todo >> nth=0 >> button >> nth=0');
  ok(/\[x\] chem lab report/.test(await p.textContent('.bb-todo')), 'to do item checked off');
  await p.goto(BASE + 'app.html');
  await p.waitForFunction(() => window.bbApi && window.bbApi.status.checked);
  const hasVoice = await p.isVisible('#bb-voice');
  ok(hasVoice === HAS_VOICE, 'my voice switch shows only when the my-voice skill exists (' + hasVoice + ')');
  if (hasVoice) {
    await p.click('#bb-voice');
    await p.fill('#bb-in', 'Write a sentence about the book.');
    const [req] = await Promise.all([p.waitForRequest((r) => /api\/solve/.test(r.url())), p.click('#bb-run')]);
    const body = JSON.parse(req.postData());
    ok(body.myVoice === true && /main guy/.test(body.voice) && body.classes[0].name === 'algebra 1', 'run sends my voice, the writing sample and the classes');
    await p.waitForSelector('#bb-done', { timeout: 30000 });
    await p.click('#bb-see');
    await p.waitForSelector('#bb-head');
    ok(await p.isChecked('#bb-voice2'), 'answers screen shows my voice is on');
  } else {
    await p.fill('#bb-in', 'Solve 3x + 7 = 22');
    await p.click('#bb-run');
    await p.waitForSelector('#bb-done', { timeout: 30000 });
    await p.click('#bb-see');
    await p.waitForSelector('#bb-head');
  }
  await p.click('#bb-tldr');
  await p.waitForFunction(() => /solving linear equations/.test((document.getElementById('bb-tl') || {}).textContent || ''), null, { timeout: 15000 });
  ok(true, 'tl;dr builds');
  await p.reload(); await p.waitForSelector('#bb-head');
  await p.click('#bb-tldr');
  ok(/solving linear equations/.test(await p.textContent('#bb-tl')), 'tl;dr is kept with the run');
  await p.screenshot({ path: OUT + '/9-tldr.png', fullPage: true });

  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
