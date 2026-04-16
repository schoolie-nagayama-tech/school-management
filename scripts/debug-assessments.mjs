import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env.local' });
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: stuList } = await supa.from('students').select('id, last_name, first_name, school_id').like('last_name','%藤田%');
console.log('students hits:', stuList);
const stu = stuList[0];
const { data: a } = await supa.from('assessments').select('*').eq('student_id', stu.id);
console.log('assessments:', a.length);
console.log(JSON.stringify(a.slice(0,2), null, 2));
const { data: s } = await supa.from('assessment_scores').select('*').in('assessment_id', a.map(x=>x.id));
console.log('scores:', s.length);
console.log(JSON.stringify(s.slice(0,5), null, 2));
