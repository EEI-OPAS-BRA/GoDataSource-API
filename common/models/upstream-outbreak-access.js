'use strict';

module.exports = function (UpstreamOutbreakAccess) {
  // decisions of the upstream servers about the outbreaks of this instance; saved by the sync (components/syncOutbreakAccess)
  UpstreamOutbreakAccess.hasController = false;
};
