import { MongoClient } from 'mongodb';
const uri = process.env.MONGODB_URI;
const c = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
try{
  await c.connect();
  const r = await c.db().admin().ping();
  console.log('PING OK:', JSON.stringify(r));
  await c.close();
  console.log('CONNECT OK');
}catch(e){
  console.error('CONNECT FAILED:', e.name, '-', e.message);
  process.exit(1);
}
