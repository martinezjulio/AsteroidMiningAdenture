// Builds the paste-ready Prolific bulk-bonus list from the game logs in Mongo.
//
//   npm run export-bonuses -- [--study STUDY_ID] [--experiment ID] [--rate N] [--out PATH]
//
// Reads MONGODB_URI from .env (point it at Atlas to export production data) and the
// bonus rate from config.json. Writes one `<submission_id>,<amount>` line per
// participant, which is exactly what Prolific's "Bulk bonus payment" dialog expects.
// Never talks to Prolific itself. Full after-study procedure: .claude/docs/computing_bonus.md
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const GameLog = require('../models/gameLog');

const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
    const args = { study: null, experiment: undefined, rate: null, out: null };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = () => {
            if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
            return argv[++i];
        };
        if (a === '--study') args.study = next();
        else if (a === '--experiment') args.experiment = next();
        else if (a === '--rate') args.rate = Number(next());
        else if (a === '--out') args.out = next();
        else if (a === '--help' || a === '-h') { printUsage(); process.exit(0); }
        else throw new Error(`unknown argument ${a}`);
    }
    return args;
}

function printUsage() {
    console.log(`usage: npm run export-bonuses -- [--study STUDY_ID] [--experiment ID] [--rate N] [--out PATH]
  --study       Prolific STUDY_ID to export (default: every study in the database)
  --experiment  experiment_id to export (default: the active config's file name, e.g. pilot_E.yaml)
  --rate        money per reward point (default: bonus_per_reward in config.json)
  --out         output file (default: exports/bonuses_<date>.csv)`);
}

function fmtMoney(v) {
    return (Math.round(v * 100) / 100).toFixed(2);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    const mongoDBUri = process.env.MONGODB_URI;
    if (!mongoDBUri) throw new Error('MONGODB_URI is not set (see .env.example)');

    const config = JSON.parse(fs.readFileSync(path.join(repoRoot, 'config.json'), 'utf8'));
    const rate = args.rate !== null ? args.rate : config.bonus_per_reward;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0) {
        throw new Error('no bonus rate: set bonus_per_reward in the active YAML (then npm run build-config) or pass --rate');
    }
    const currency = config.bonus_currency || '$';
    // server.js logs experiment_id as the basename of experiment_config.
    const experiment = args.experiment !== undefined
        ? args.experiment
        : (config.experiment_config || '').split('/').pop();

    // Only play games count toward the reward (practice and watch never do). Each shoot
    // row carries reward_generated for that shot, so counting rewarded shots is exact
    // regardless of total_reward_scope, row order, or whether the game was finished.
    const match = { game: 'play' };
    if (args.study) match.prolific_study_id = args.study;
    if (experiment) match.experiment_id = experiment;

    await mongoose.connect(mongoDBUri);
    try {
        const rows = await GameLog.aggregate([
            { $match: match },
            // Per play game: rewarded shots, and the tally the client reported for the
            // game (its max is complete only when trajectory_complete was logged).
            { $group: {
                _id: { pid: '$prolific_id', sub: '$prolific_session_id', study: '$prolific_study_id',
                       session: '$session_index', game: '$game_index' },
                rewards: { $sum: { $cond: [{ $and: ['$shot', '$reward_generated'] }, 1, 0] } },
                shots: { $sum: { $cond: ['$shot', 1, 0] } },
                client_game_reward: { $max: '$game_total_reward' },
                finished: { $max: { $cond: [{ $eq: ['$action', 'trajectory_complete'] }, 1, 0] } },
                condition_order: { $max: '$condition_order' },
                first: { $min: '$timestamp' },
                last: { $max: '$timestamp' },
            } },
            // Per participant.
            { $group: {
                _id: { pid: '$_id.pid', sub: '$_id.sub', study: '$_id.study' },
                total_reward: { $sum: '$rewards' },
                client_total: { $sum: '$client_game_reward' },
                play_shots: { $sum: '$shots' },
                play_games: { $sum: 1 },
                finished_games: { $sum: '$finished' },
                sessions: { $addToSet: '$_id.session' },
                condition_order: { $max: '$condition_order' },
                first: { $min: '$first' },
                last: { $max: '$last' },
            } },
            { $sort: { last: 1 } },
        ]);

        if (rows.length === 0) {
            console.log(`No play rows matched ${JSON.stringify(match)}.`);
            return;
        }

        const paid = [];
        const skipped = [];
        const warnings = [];
        for (const r of rows) {
            const p = {
                prolific_id: r._id.pid,
                submission_id: r._id.sub || null,
                study_id: r._id.study || null,
                total_reward: r.total_reward,
                play_shots: r.play_shots,
                games: `${r.finished_games}/${r.play_games}`,
                sessions: r.sessions.sort((a, b) => a - b).join(','),
                bonus: fmtMoney(r.total_reward * rate),
                last_played: r.last ? new Date(r.last).toISOString().replace('T', ' ').slice(0, 16) : '',
                condition_order: r.condition_order || '',
            };
            if (r.finished_games !== r.play_games) {
                warnings.push(`${p.prolific_id}: ${r.play_games - r.finished_games} play game(s) not finished (refresh or drop-out?)`);
            } else if (r.client_total !== r.total_reward) {
                warnings.push(`${p.prolific_id}: rewarded shots = ${r.total_reward} but client-reported game totals sum to ${r.client_total}; check the raw rows`);
            }
            (p.submission_id ? paid : skipped).push(p);
        }

        console.log(`Bonus rate: ${currency}${rate} per reward point` +
            (args.study ? `, study ${args.study}` : ', all studies') +
            (experiment ? `, experiment ${experiment}` : '') + '\n');
        const cols = ['prolific_id', 'submission_id', 'study_id', 'total_reward', 'play_shots', 'games', 'sessions', 'bonus', 'last_played'];
        console.table(paid.map(p => Object.fromEntries(cols.map(c => [c, p[c]]))));

        if (skipped.length) {
            console.log(`Skipped (no Prolific SESSION_ID, e.g. local test runs — not written):`);
            for (const p of skipped) console.log(`  ${p.prolific_id}  reward ${p.total_reward}  last played ${p.last_played}`);
            console.log('');
        }
        for (const w of warnings) console.log(`WARNING ${w}`);
        if (warnings.length) console.log('');

        const grand = paid.reduce((s, p) => s + Number(p.bonus), 0);
        console.log(`${paid.length} participant(s) to pay, total ${currency}${fmtMoney(grand)} before Prolific fees.`);

        const outPath = path.resolve(repoRoot, args.out || path.join('exports', `bonuses_${new Date().toISOString().slice(0, 10)}.csv`));
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, paid.map(p => `${p.submission_id},${p.bonus}`).join('\n') + (paid.length ? '\n' : ''));
        const shown = path.relative(repoRoot, outPath);
        console.log(`Paste-ready list written to ${shown.startsWith('..') ? outPath : shown}`);
    } finally {
        await mongoose.disconnect();
    }
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
