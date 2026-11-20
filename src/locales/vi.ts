// Vietnamese dictionary, split by area so files stay readable. `common` comes last so shared words
// (Cancel, Save, Delete…) read the same everywhere.
import { app } from './vi/app';
import { common } from './vi/common';
import { lib } from './vi/lib';
import { load } from './vi/load';
import { request } from './vi/request';
import { shell } from './vi/shell';

export const vi: Record<string, string> = {
  ...app,
  ...request,
  ...load,
  ...shell,
  ...lib,
  ...common,
};
