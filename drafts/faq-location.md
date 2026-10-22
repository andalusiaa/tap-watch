# Draft FAQ: "Why are the distances wrong on my phone?"

Not on the site yet. Drop it into `/about/` as a section, or make it its own page, whenever
Tristan says. Written in plain language to match the rest of the site.

---

## Why are the distances wrong on my phone?

Nine times out of ten, your phone has given the browser a deliberately vague position.

Phones keep two separate settings: one for apps like Google Maps, and one for your web
browser. Maps can be pinpoint while Safari or Chrome is told to report only a rough area,
which can put you a mile from where you're standing. Tap Watch always asks for the most
accurate position your browser will give, so the fix is in your phone's settings.

### How to tell

Tap **Use my location** and read the small line underneath. It says how accurate the
position is:

- **1 km or more:** your browser is being given a rough position on purpose. Turn on precise
  location below.
- **Under 100 m but the wrong place:** your phone is guessing from a nearby wifi network or
  phone mast. Stepping outside, or entering a postcode, sorts it.

### Turn on precise location

**iPhone or iPad**
1. Settings → Privacy & Security → Location Services.
2. Check Location Services is on.
3. Scroll down to **Safari Websites** (or Chrome, or whichever browser you use).
4. Choose **While Using the App**, and turn **Precise Location** on.
5. Go back to Tap Watch, reload the page, and tap Use my location again.

**Android**
1. Settings → Location → App permissions.
2. Choose your browser, usually Chrome.
3. Allow location while the app is in use, and turn on **Use precise location**.
4. Reload Tap Watch and tap Use my location again.

### Still out by a street or two?

- **Private Relay or a VPN.** If your phone can't get a proper fix, the browser falls back to
  your internet connection, which these deliberately make vague. Turn it off for a moment and
  try again.
- **Low Power Mode** can stop a phone using GPS properly.
- **Thick walls and basements.** GPS struggles indoors, and pubs are not known for their
  windows. Try by a window or outside the door.
- **Tap Watch reuses a position for a minute,** so if you get a bad reading and retry straight
  away you'll see the same spot. Wait a minute, or reload the page.

### Just use a postcode instead

You never have to share your location. Open the search card, choose **Enter a postcode**, and
type the postcode you want distances measured from. It's often more accurate than a phone
indoors, and the postcode is only used to work out distances.

### Does Tap Watch see where I am?

No. Your position stays on your device and is used there to work out how far each pub is.
It is never sent to us or stored. A postcode you type is sent to a free public postcode
service to look up where it is, and nothing is kept. See the privacy page.
