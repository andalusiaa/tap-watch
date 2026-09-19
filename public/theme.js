// Light or dark, chosen before the page draws so it never flashes the wrong colours.
// "Auto" (the default) is dark from sunset to sunrise in Walthamstow, worked out here
// on the device. A visitor can pick Light or Dark instead; that choice stays on their device.
// Loaded as a small blocking script because the CSP forbids inline scripts.
(function () {
  var LAT = 51.5855;
  var LNG = -0.021;
  var KEY = 'tw-theme';
  var root = document.documentElement;
  var timer = 0;

  // Sunrise and sunset (sun 0.833° below the horizon), after the NOAA / suncalc method.
  function sunTimes(date) {
    var rad = Math.PI / 180;
    var dayMs = 86400000;
    var J1970 = 2440588;
    var J2000 = 2451545;
    var d = date.valueOf() / dayMs - 0.5 + J1970 - J2000;
    var lw = rad * -LNG;
    var phi = rad * LAT;
    var n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
    var ds = 0.0009 + lw / (2 * Math.PI) + n;
    var M = rad * (357.5291 + 0.98560028 * ds);
    var C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    var L = M + C + rad * 102.9372 + Math.PI;
    var dec = Math.asin(Math.sin(rad * 23.4397) * Math.sin(L));
    var noon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    var w = Math.acos((Math.sin(rad * -0.833) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
    var set = J2000 + 0.0009 + (w + lw) / (2 * Math.PI) + n + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    var rise = noon - (set - noon);
    var toDate = function (j) { return new Date((j + 0.5 - J1970) * dayMs); };
    return { rise: toDate(rise), set: toDate(set) };
  }

  function choice() {
    try {
      var saved = localStorage.getItem(KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (e) {}
    return 'auto';
  }

  function apply() {
    clearTimeout(timer);
    var mode = choice();
    var now = new Date();
    var dark;
    if (mode === 'auto') {
      var sun = sunTimes(now);
      dark = now < sun.rise || now >= sun.set;
      // Check again at the next sunrise or sunset (or in an hour, whichever is sooner).
      var next = now < sun.rise ? sun.rise : now < sun.set ? sun.set : sunTimes(new Date(now.valueOf() + 86400000)).rise;
      timer = setTimeout(apply, Math.min(Math.max(next - now, 1000), 3600000));
    } else {
      dark = mode === 'dark';
    }
    var theme = dark ? 'dark' : 'light';
    root.setAttribute('data-theme-choice', mode);
    if (root.getAttribute('data-theme') !== theme) {
      root.setAttribute('data-theme', theme);
      document.dispatchEvent(new CustomEvent('tw-themechange', { detail: theme }));
    }
  }

  window.tapWatchTheme = {
    choice: choice,
    set: function (mode) {
      try {
        if (mode === 'auto') localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, mode);
      } catch (e) {}
      apply();
    },
    sunTimes: sunTimes,
  };

  apply();
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) apply();
  });
})();
