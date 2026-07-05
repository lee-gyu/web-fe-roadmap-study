import { getPhaseGroups } from '../navigation';

export default {
  watch: 'phase-*/*.md',
  load() {
    return getPhaseGroups();
  },
};
