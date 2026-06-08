require('dotenv').config();
const bcrypt = require('bcrypt');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function createAdmin() {
  const email = 'admin@anvoxa.com';       // ← change this
  const password = 'yourStrongPassword';  // ← change this (min 8 chars)

  const password_hash = await bcrypt.hash(password, 12);

  const { data, error } = await supabase
    .from('admin_users')
    .insert({ email, password_hash })
    .select('id, email, created_at')
    .single();

  if (error) {
    console.error('❌ Failed:', error.message);
  } else {
    console.log('✅ Admin created:', data);
  }

  process.exit(0);
}

createAdmin();
