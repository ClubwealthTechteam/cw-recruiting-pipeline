// Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { oljInviteText } = require('../routines/olj_send.js');

const APPROVED = `Greetings from Club Wealth!

Please join our virtual pre-interview tomorrow, Wednesday, October 28, 2026, at 2:00 PM PACIFIC DAYLIGHT TIME on our Zoom interview.

You can refer to Time Buddy to check the time in your area and calculate your time zone to Pacific Daylight Time. Follow this to ensure you do not miss the interview.
Note the time zone difference: Pacific Daylight Time is what we follow here, as the Company is based in Washington State.

Here is the link to join the interview: www.clubwealthhelp.com

Important Reminders:

• Kindly join 10 minutes before the call. Late attendees will not be entertained.
• Use your own work equipment for the interview (headset, microphone, and camera must be working well. Preferably connected with a LAN cable). Failure to use the proper equipment will not be processed.
• Upon joining Zoom, please change your name with the role you applied for. (Ex. John Smith_Position)
• Effective communication is essential for successfully passing an interview.
• No reschedules

Note: Setting your expectations that we require a minimum of 50 Mbps for both download and upload speeds while connected to a LAN cable, as you will be working from home and managing multiple applications. This ensures we can work efficiently together once you are hired.

Please confirm your availability by replying with your FULL NAME`;

test('OLJ invite is exactly the text Miguel approved and sent on Oct 27', () => {
  assert.equal(oljInviteText('2026-10-28', new Date('2026-10-27T15:00:00-07:00')), APPROVED);
});

test('OLJ invite date and zone follow the session', () => {
  const t = oljInviteText('2026-11-04', new Date('2026-10-29T10:00:00-07:00'));
  assert.match(t, /pre-interview on Wednesday, November 4, 2026, at 2:00 PM PACIFIC STANDARD TIME/);
  assert.doesNotMatch(t, /Daylight/i);
});
