// Optional mode preferences are isolated from the main player and tournament state.
let bokhOptedIn = false;
try {
  bokhOptedIn = localStorage.getItem("enomad-bokh-opt-in") === "true";
} catch {}
function bokh() {
  return (
    heading(
      "Daily Bökh builds warriors.",
      "Optional mode · A separate cultural identity and rank",
      '<button class="join" data-page="tournaments">Back to tournaments ↗</button>',
    ) +
    `<section class="economy-banner"><span class="eyebrow">NAADAM BÖKH · V1.1</span><h2>ARENA DAY BÖKH<br>CREATES LEGENDS.</h2><p>Choose this mode when you want to compete under Bökh rules.</p><button class="primary" id="bokh-opt-in">${bokhOptedIn ? "Leave Bökh mode" : "Enable Bökh mode"}</button></section><div class="notice">${bokhOptedIn ? "Bökh mode enabled on this device." : "Bökh mode is optional. Enable it to see your mode profile."} Game rank, regular tournament rules, and wallet balance stay unchanged. Live matchmaking and cultural rank calculation are not connected.</div>${bokhOptedIn ? `<section class="panel"><span class="eyebrow">YOUR BÖKH IDENTITY</span><h2>${esc(state.name)}</h2><div class="stats"><div class="stat"><span class="eyebrow">CULTURAL RANK</span><strong>Unranked</strong><small>Awaiting verified Bökh matches</small></div><div class="stat"><span class="eyebrow">HONOR · COURAGE · DISCIPLINE</span><strong>— · — · —</strong><small>No verified mode history yet</small></div></div><button class="primary" id="bokh-enter">Enter Bökh Arena – 1v1 ↗</button><p class="economy-note">Issue Challenge and squads unlock at a verified Zaan, Arslan, or Champion rank. No rank is granted by opting in.</p></section>` : ""}<div class="tournament-grid"><section class="panel"><span class="eyebrow">REGULAR DAYS</span><h2>Daily Bökh Arena</h2><p class="economy-note">Default 1v1. Automatic matching prioritizes the same Bökh tier, independent of game skill rank. Training, skill growth, streaks, and gradual cultural progression.</p><p class="economy-note">Small entry, medium win rewards, and a slow streak multiplier are proposed; numeric rates are not defined.</p></section><section class="panel"><span class="eyebrow">DESIGNATED ARENA DAYS</span><h2>Ceremonial Bökh Arena</h2><p class="economy-note">Rank-protected seeding, ceremony, larger cultural progression, and permanent title badges. Ceremonial entry and larger reward pools are planned.</p><p class="economy-note">No ceremonial event is announced. Qualification and title awards require verified results.</p></section><section class="panel"><span class="eyebrow">ZAAN · ARSLAN · CHAMPION</span><h2>Challenge rights</h2><p class="economy-note">Within this optional mode, eligible high ranks may choose a rival within the permitted cultural-rank range, format, and battlefield. The recipient accepts or declines.</p><p class="economy-note">This mode-specific privilege does not change automatic brackets in regular tournaments. Rank ranges and Honor effects for declines remain unconfigured.</p></section><section class="panel"><span class="eyebrow">2–5 PLAYERS · ZAAN+ LEADERS</span><h2>Team Bökh battles</h2><p class="economy-note">Eligible leaders form squads, select teammates and size, and issue protected mode challenges. Titles apply to team and individual Bökh identities.</p></section><section class="panel"><span class="eyebrow">YOUR CAFÉ · YOUR HOUSE</span><h2>Café Bökh teams</h2><p class="economy-note">Café team, local broadcast channel, café badge, and physical location identity. Represent your house and travel for away matches.</p><p class="economy-note">Café → District → City → Aimag → National → International. Café rank, members, and upcoming battles require a connected team service.</p></section><section class="panel"><span class="eyebrow">MODE REPUTATION</span><h2>Honor. Courage. Discipline.</h2><p class="economy-note">Verified Bökh matches update these separate cultural measures. The proposal includes Honor reductions for challenge declines. Confirmed violations follow the updated graduated-penalty policy, potentially including identity revocation after review.</p><p class="economy-note">No penalties are applied in this preview. Decline thresholds, amounts, review, and recovery rules require definition.</p></section></div>`
  );
}
document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.id === "bokh-opt-in") {
    bokhOptedIn = !bokhOptedIn;
    try {
      localStorage.setItem("enomad-bokh-opt-in", String(bokhOptedIn));
    } catch {
      toast("Mode preference lasts for this visit only.");
    }
    render();
  }
  if (button.id === "bokh-enter" && bokhOptedIn) {
    modal(
      "Daily Bökh · 1v1",
      '<p>Your preference is enabled, but live matchmaking is not available yet.</p><p>A connected service will match verified players by Bökh cultural tier. No entry tokens have been charged and no queue position or opponent has been assigned.</p><button class="primary wide" id="close-entry">Got it</button>',
    );
  }
});
