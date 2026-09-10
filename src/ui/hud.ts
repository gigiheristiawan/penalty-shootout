import { CHARGE_CYCLE_SECONDS, KICKS_PER_ROUND } from '../constants';
import { OUTCOME_LABEL, type Outcome, type RoundSummary } from '../game/scoring';

/**
 * The HUD is plain DOM layered over the canvas (spec §4). Nothing here touches
 * WebGL: text and bars are things the browser is already extremely good at, and
 * drawing them in 3D would mean fonts, textures and extra draw calls for no gain.
 */

export class PowerMeter {
  private readonly root: HTMLElement;
  private readonly fill: HTMLElement;

  /** Seconds since charging began. Drives the oscillation. */
  private elapsed = 0;
  private charging = false;

  constructor(parent: HTMLElement = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'power-meter';
    this.root.hidden = true;

    this.fill = document.createElement('div');
    this.fill.className = 'power-meter__fill';

    this.root.appendChild(this.fill);
    parent.appendChild(this.root);
  }

  start(): void {
    this.charging = true;
    this.elapsed = 0;
    this.root.hidden = false;
    this.render(0);
  }

  /**
   * Advance the meter. Called once per physics tick so the oscillation runs at
   * the same rate on every machine — the same reason physics uses a fixed step.
   */
  update(deltaSeconds: number): void {
    if (!this.charging) return;

    this.elapsed += deltaSeconds;
    this.render(this.power);
  }

  /**
   * A triangle wave: 0 → 1 → 0 → 1 …, one full cycle per CHARGE_CYCLE_SECONDS.
   *
   * The oscillation is the whole mechanic (spec §6). A bar that only fills
   * rewards holding the button down, which is not a decision. A bar that sweeps
   * past its peak turns power into a timing problem, so a full-power shot costs
   * something.
   */
  get power(): number {
    const phase = (this.elapsed % CHARGE_CYCLE_SECONDS) / CHARGE_CYCLE_SECONDS;
    return phase < 0.5 ? phase * 2 : 2 - phase * 2;
  }

  /** Stops charging and returns the power at the moment of release. */
  release(): number {
    const finalPower = this.power;
    this.charging = false;
    this.root.hidden = true;
    return finalPower;
  }

  private render(power: number): void {
    this.fill.style.transform = `scaleX(${power})`;
    // Green through amber to red as the bar approaches maximum.
    const hue = 120 - power * 120;
    this.fill.style.backgroundColor = `hsl(${hue} 80% 55%)`;
  }
}

/**
 * Score readout: kick counter plus one pip per kick taken.
 *
 * The pips do the real work. "3/5" tells you where you are; a row of filled and
 * hollow dots tells you the shape of the round at a glance, which is what makes
 * the last kick feel like the last kick.
 */
export class ScoreDisplay {
  private readonly root: HTMLElement;
  private readonly count: HTMLElement;
  private readonly pips: HTMLElement;

  constructor(parent: HTMLElement = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'score';

    this.count = document.createElement('div');
    this.count.className = 'score__count';

    this.pips = document.createElement('div');
    this.pips.className = 'score__pips';

    this.root.append(this.count, this.pips);
    parent.appendChild(this.root);
  }

  update(summary: RoundSummary): void {
    this.count.textContent = `${summary.goals} / ${KICKS_PER_ROUND}`;

    this.pips.replaceChildren(
      ...Array.from({ length: KICKS_PER_ROUND }, (_unused, index) => {
        const pip = document.createElement('span');
        const outcome = summary.outcomes[index];

        pip.className = 'pip';
        if (outcome !== undefined) {
          pip.classList.add(outcome === 'GOAL' ? 'pip--goal' : 'pip--missed');
        }
        return pip;
      }),
    );
  }
}

/** The brief banner shown in the RESOLVED state. */
export class OutcomeBanner {
  private readonly root: HTMLElement;

  constructor(parent: HTMLElement = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'banner';
    this.root.hidden = true;
    parent.appendChild(this.root);
  }

  show(outcome: Outcome): void {
    this.root.textContent = OUTCOME_LABEL[outcome];
    this.root.dataset.outcome = outcome;
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }
}

/**
 * The ROUND_OVER screen. Deliberately plain — phase 5 owns presentation; this
 * exists so the state machine has somewhere to land after the fifth kick.
 */
export class ResultScreen {
  private readonly root: HTMLElement;
  private readonly heading: HTMLElement;
  private readonly detail: HTMLElement;

  constructor(onRestart: () => void, parent: HTMLElement = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'result';
    this.root.hidden = true;

    this.heading = document.createElement('h1');
    this.heading.className = 'result__heading';

    this.detail = document.createElement('p');
    this.detail.className = 'result__detail';

    const button = document.createElement('button');
    button.className = 'result__button';
    button.textContent = 'Play again';
    button.addEventListener('click', onRestart);

    this.root.append(this.heading, this.detail, button);
    parent.appendChild(this.root);
  }

  show(summary: RoundSummary, bestScore: number): void {
    this.heading.textContent = `${summary.goals} of ${KICKS_PER_ROUND}`;
    this.detail.textContent = `${describeRound(summary.goals)} Best: ${bestScore}/${KICKS_PER_ROUND}.`;
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }
}

function describeRound(goals: number): string {
  if (goals === KICKS_PER_ROUND) return 'Perfect round.';
  if (goals >= 4) return 'Nearly flawless.';
  if (goals >= 2) return 'Room to improve.';
  return 'The keeper will sleep well.';
}

/**
 * Curve selector: a small left/right bias chosen before the kick (spec §2).
 *
 * Shown as a bar with a marker off centre, because "curve: -0.6" means nothing
 * mid-run while a marker sitting left of centre is instantly readable.
 */
export class CurveIndicator {
  private readonly root: HTMLElement;
  private readonly knob: HTMLElement;

  constructor(parent: HTMLElement = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'curve';

    const label = document.createElement('span');
    label.className = 'curve__label';
    label.textContent = 'curve  ←  A / D  →';

    const track = document.createElement('div');
    track.className = 'curve__track';

    this.knob = document.createElement('div');
    this.knob.className = 'curve__knob';

    track.appendChild(this.knob);
    this.root.append(label, track);
    parent.appendChild(this.root);
  }

  /** `curve` runs -1 (bend left) .. +1 (bend right). */
  update(curve: number): void {
    this.knob.style.left = `${50 + curve * 50}%`;
    this.root.classList.toggle('curve--active', curve !== 0);
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }
}

/**
 * Debug panel. Spec §8 asks for the keeper's read probability to be adjustable,
 * because "tune by play-testing" is impossible if tuning means an edit-reload
 * cycle. Toggled with `~`.
 */
export class DebugPanel {
  private readonly root: HTMLElement;

  constructor(
    initialReadProbability: number,
    onReadProbabilityChange: (value: number) => void,
    parent: HTMLElement = document.body,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'debug';
    this.root.hidden = true;

    const label = document.createElement('label');
    label.className = 'debug__row';

    const text = document.createElement('span');
    const setText = (value: number) => {
      text.textContent = `keeper reads aim: ${Math.round(value * 100)}%`;
    };
    setText(initialReadProbability);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.05';
    slider.value = String(initialReadProbability);
    slider.addEventListener('input', () => {
      const value = Number(slider.value);
      setText(value);
      onReadProbabilityChange(value);
    });

    label.append(text, slider);
    this.root.appendChild(label);
    parent.appendChild(this.root);
  }

  toggle(): void {
    this.root.hidden = !this.root.hidden;
  }
}

/** Transient toast, used for the sound toggle. */
export function showToast(message: string): void {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  window.setTimeout(() => toast.remove(), 1200);
}

/**
 * The colophon (spec §6: a small "how this was built" note, so the game becomes
 * writing material). A modal rather than a separate page — it keeps the whole
 * thing one deployable artefact, and the copy lives next to the code it
 * describes.
 */
export function createColophon(): void {
  const trigger = document.querySelector<HTMLElement>('.colophon');
  const modal = document.querySelector<HTMLElement>('.about');
  const close = document.querySelector<HTMLElement>('.about__close');
  if (trigger === null || modal === null || close === null) return;

  trigger.addEventListener('click', () => {
    modal.hidden = false;
  });
  close.addEventListener('click', () => {
    modal.hidden = true;
  });
  modal.addEventListener('click', (event) => {
    if (event.target === modal) modal.hidden = true;
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') modal.hidden = true;
  });
}
