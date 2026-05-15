import { type SportType } from '@/types/player';

export interface CourtDimensions {
  widthM: number;
  lengthM: number;
  serviceBoxLengthM: number;
  netHeightCenterM: number;
  singlesWidthM: number;
  doublesWidthM: number;
}

const TENNIS_COURT: CourtDimensions = {
  widthM: 10.97,
  lengthM: 23.77,
  serviceBoxLengthM: 6.4,
  netHeightCenterM: 0.914,
  singlesWidthM: 8.23,
  doublesWidthM: 10.97,
};

// ソフトテニスは硬式と同じコート寸法を使用
const SOFT_TENNIS_COURT: CourtDimensions = {
  ...TENNIS_COURT,
};

export function getCourtDimensions(sportType: SportType): CourtDimensions {
  return sportType === 'softTennis' ? SOFT_TENNIS_COURT : TENNIS_COURT;
}
