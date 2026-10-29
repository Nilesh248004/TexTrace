import { openDb } from '../../server/db';
import { defineSuite } from './suite';

defineSuite('TexTrace v2 API (SQLite)', async () => openDb(':memory:'));
