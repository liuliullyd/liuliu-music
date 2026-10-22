import { NativeModules } from 'react-native';
import type { HeadphoneEqProfileEntity } from '../src/services/headphones';
declare const __dirname: string;
const fs = require('node:fs');
const path = require('node:path');
export const headphoneAssetText = (id: string): string => fs.readFileSync(
  path.resolve(__dirname, '../android/app/src/main/assets/headphones', id + '.json'), 'utf8');
export const headphoneAssetProfiles = (id: string): HeadphoneEqProfileEntity[] => JSON.parse(headphoneAssetText(id));
NativeModules.LiuliuStorage = { ...NativeModules.LiuliuStorage,
  readBundledHeadphoneProfiles: jest.fn(async (id: string) => headphoneAssetText(id)) };
