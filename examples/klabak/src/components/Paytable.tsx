import { CABINETS, PROB_SCALE, MULT_SCALE, DECLARED_RTP_PPM, rtpPpm, type Cabinet } from '../lib/tables.generated';
import { TIER_COLORS } from './ClawMachine';

/**
 * The paytable, printed from the same generated module the contract is built
 * from — so what a player reads here is what `KlabakGame.declaredRtpPpm()`
 * returns on-chain. This table is the jam's "declared math" in human form.
 */
export function Paytable({ cabinet }: { cabinet: Cabinet }) {
  const rtp = rtpPpm(cabinet) / 10_000;
  return (
    <div className="kl-paytable">
      <div className="kl-paytable-head">
        <h3>{cabinet.name}</h3>
        <span className="kl-rtp-chip">
          RTP {(rtp * 100).toFixed(2)}% <em>declared {(DECLARED_RTP_PPM / 10_000).toFixed(2)}%</em>
        </span>
      </div>
      <p className="kl-blurb">{cabinet.blurb}</p>
      <table>
        <thead>
          <tr>
            <th>Prize</th>
            <th>Chance</th>
            <th>Pays</th>
            <th>Contribution</th>
          </tr>
        </thead>
        <tbody>
          {cabinet.tiers.map(t => {
            const p = t.weight / PROB_SCALE;
            const m = t.multiplier / MULT_SCALE;
            return (
              <tr key={t.tier} className={t.multiplier === 0 ? 'is-slip' : undefined}>
                <td>
                  <span className="kl-chip" style={{ background: TIER_COLORS[Math.min(t.tier, 3)] }} />
                  {t.multiplier === 0 ? 'the claw slips' : t.prize}
                </td>
                <td className="num">{(p * 100).toFixed(3)}%</td>
                <td className="num">{m === 0 ? '—' : `×${m.toFixed(2)}`}</td>
                <td className="num">{(p * m * 100).toFixed(3)}%</td>
              </tr>
            );
          })}
          <tr className="is-total">
            <td colSpan={3}>Return to player</td>
            <td className="num">{rtp.toFixed(2)}%</td>
          </tr>
        </tbody>
      </table>
      <p className="kl-fineprint">
        Weights sum to {CABINETS[cabinet.id].tiers.reduce((a, t) => a + t.weight, 0).toLocaleString()} ppm = 100%.
        Same numbers are emitted into <code>KlabakGame.sol</code> by one generator; the contract recomputes this
        sum in <code>declaredRtpPpm()</code>.
      </p>
    </div>
  );
}
