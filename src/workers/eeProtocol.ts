// Protokół wiadomości główny wątek ↔ worker e⁺e⁻.
import type { DalitzSnapshot, HistSnapshot } from '../analysis/eeAnalysis';
import type { ScanPoint } from '../analysis/scan';
import type { AngularDist } from '../physics/angular';
import type { P4, V3 } from '../physics/vec4';
import type { EventMeta } from '../sim/event';
import type { EESettings } from '../sim/eeRun';

export interface DecayInfo {
  parent: number;
  daughters: [number, number];
  vertex: [number, number, number, number];
  P: P4;
  angular: AngularDist | null;
  axisRest: V3 | null;
  dirRest: V3 | null;
  toy: boolean;
}

export interface ProcessRow {
  key: string;
  label: string;
  kind: string;
  toy: boolean;
  sigma_nb: number;
}

export type ToEE =
  | { type: 'settings'; settings: EESettings }
  | { type: 'next'; burst: number }
  | { type: 'goto'; index: number; reroll: number }
  | { type: 'sigma'; sqrtS: number }
  | { type: 'scanMeasure'; sqrtS: number; lumi: number; spreadRel: number; point: number }
  | { type: 'scanTheory'; lo: number; hi: number; n: number; spreadRel: number }
  | { type: 'reset' };

export interface EventMsg {
  type: 'event';
  index: number;
  reroll: number;
  data: Float64Array;
  size: number;
  meta: EventMeta;
  decays: DecayInfo[];
  processLabel: string;
  generated: number;
}

export type FromEE =
  | EventMsg
  | { type: 'stats'; hists: HistSnapshot[]; dalitz: DalitzSnapshot; generated: number; ms: number }
  | { type: 'sigma'; sqrtS: number; rows: ProcessRow[] }
  | { type: 'scanPoint'; point: ScanPoint }
  | { type: 'scanTheory'; xs: number[]; ys: number[]; spreadRel: number }
  | { type: 'error'; message: string };
