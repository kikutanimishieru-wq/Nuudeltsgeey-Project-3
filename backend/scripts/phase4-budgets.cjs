// Milliseconds. Lock wait exceeds the directed winner's whole transaction budget.
module.exports = Object.freeze({
 barrier: 10000, winnerTransaction: 60000, waiterTransaction: 150000,
 lock: 75000, statement: 80000, pool: 10000,
 test: 300000, hook: 120000, suite: 2700000,
});
