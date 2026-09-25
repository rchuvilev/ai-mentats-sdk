/**
 * ai-mentats-sdk — single entry point.
 *
 * Consumers vendor this repo as a git submodule at `sdk/` and require the
 * pieces they need. Scripts meant to be *run* (bundle-electron, publish,
 * release, pty-helper) are invoked by path, not required, so they are not
 * re-exported here.
 */
'use strict';

module.exports = {
  dataDir: require('./utils/data-dir'),
  autoUpdate: require('./logic/auto-update'),
};
