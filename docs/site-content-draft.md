# One-pager site — Adam's content draft (transcribed from his outline, July 1 2026)

## Value of ToF

- Improve your Threads experience by interacting more often with open, kind, and interesting people
- With just one click, ToF helps you better understand a fellow Threads community member... sharing quick stats about their involvement on the service as well as offering a brief, frank summary of WHAT they write about and HOW they engage with others.

## Availability and requirements to use

- **This extension is currently available only to a very limited set of people for testing purposes.**
  You can request to be notified [link TBD] if and when it's more broadly available.
- The extension functions only in desktop/laptop Chrome and (most) Chromium browsers.
  - ✅ Chrome, Chrome Beta, and Comet (tested on Mac)
  - ❌ Atlas, Firefox, Opera, Safari
  - ❌ Threads mobile apps and Threads on mobile web
- It relies on you bringing your own Claude API key [link], and you can expect costs of around 0.2–0.3 cents per profile queried.
- It has been tested only in browsers set to English

## Privacy

- No information is sent directly from the extension to Meta; Meta can only see what profile names you've hovered over (same as without the extension!) and their logs will also show your browser accessing a user's profile page when you hover their profile name (since the extension silently opens up their profile page to read and analyze that person's public posts and replies).
- The extension does not itself send ANY information to anyone, including the extension's author. In the future, the extension may send very high-level non-personal, aggregated, 100% anonymized usage data to @ThatAdamGuy (such as total number of users, number of profile lookups, etc.). Again, no identifying info of the extension users or the people they're looking up is or will be stored or sent.

## [Put somewhere, not necessarily all in the same place :D]

- Thriend or Faux logo
- Made by @ThatAdamGuy and Claude
- NOT affiliated with or endorsed by Meta or Anthropic

## Notes (Claude)

- Privacy section needs one addition for accuracy/compliance: profile data (bio, posts, replies) IS sent to **Anthropic's API** for analysis using the user's own key — "does not send ANY information to anyone" needs that carve-out spelled out. A fuller standalone privacy.html is required for the Chrome Web Store listing anyway.
- "Request to be notified" link: simplest free option is a Google Form.
