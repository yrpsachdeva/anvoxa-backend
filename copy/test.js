const bcrypt = require('bcrypt');

const password = 'Admin@1234';
const hash = '$2b$12$bSYI67mowzSxma6L1qb76u7Wr0IluA2imRnkoE.wr2Oa5PkFr53Sq';

bcrypt.compare(password, hash).then(r => console.log('match:', r));

bcrypt.hash('Anviton@04/2026', 12).then(h => console.log(h));