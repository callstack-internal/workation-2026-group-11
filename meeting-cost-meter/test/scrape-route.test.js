import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMcm } from './load-mcm.js';

const { scrape } = loadMcm('extension/content/scrape.js');

test('only Meet conference-code paths are treated as meeting pages', () => {
  assert.equal(scrape.isMeetingPath('/abc-defg-hij'), true);
  assert.equal(scrape.isMeetingPath('/ABC-DEFG-HIJ/'), true);

  for (const path of ['/', '/landing', '/new', '/lookup/team-sync', '/settings']) {
    assert.equal(scrape.isMeetingPath(path), false, path);
  }
});

test('meetingCodeFromPath returns a normalized code or null', () => {
  assert.equal(scrape.meetingCodeFromPath('/ABC-DEFG-HIJ'), 'abc-defg-hij');
  assert.equal(scrape.meetingCodeFromPath('/landing'), null);
  assert.equal(scrape.meetingCodeFromPath(''), null);
});

test('post-meeting headings are recognized without matching active-call text', () => {
  for (const text of [
    'You left the meeting',
    'You have left the call',
    "You've left the meeting",
    'The meeting has ended',
    'Call ended',
  ]) {
    assert.equal(scrape.isMeetingEndedText(text), true, text);
  }
  for (const text of ['Ready to join?', 'People in this call', 'Leave call', 'Meeting details']) {
    assert.equal(scrape.isMeetingEndedText(text), false, text);
  }
});

test('Rejoin plus Return to home screen is a post-meeting fallback signal', () => {
  assert.equal(
    scrape.hasPostMeetingControls(['Submit feedback', 'Rejoin', 'Return to home screen']),
    true,
  );
  assert.equal(scrape.hasPostMeetingControls(['Join now', 'Cancel']), false);
  assert.equal(scrape.hasPostMeetingControls(['Rejoin']), false);
});
