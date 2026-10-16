// Pure policy helper. Pass every participant's verified floor, including teammates.
// Advanced unlock floors are supplied by approved policy, never inferred here.
function getStyleEligibility(participantFloors, advancedUnlocks = {}) {
  if (!Array.isArray(participantFloors) || !participantFloors.length ||
      participantFloors.some(floor => !Number.isSafeInteger(floor) || floor < 1)) {
    return { status: 'pending-roster', minimumFloor: null, styles: [] };
  }
  const minimumFloor = Math.min(...participantFloors);
  const styles = ['Open Bracket'];
  if (minimumFloor >= 3) {
    for (const [style, floor] of Object.entries(advancedUnlocks)) {
      if (['Swiss System', 'League Round Robin', 'Floor Climb', 'Bökh Challenge Mode', 'Cafe War Mode', 'Speed Ladder'].includes(style) &&
          Number.isSafeInteger(floor) && floor >= 3 && floor <= minimumFloor) styles.push(style);
    }
  }
  return { status: 'evaluated', minimumFloor, styles };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { getStyleEligibility };
