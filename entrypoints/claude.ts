import { installAdapter } from '../platform/content';
import { createDomAdapter } from '../providers/dom';
import { CONFIGS } from '../providers/configs';
export default defineUnlistedScript(() => installAdapter(createDomAdapter(CONFIGS.claude)));
