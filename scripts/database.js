import mongoose from 'mongoose';
import {loadConfig} from '../server/src/config/env.js';
import {MongoRepository,initializeDatabase} from '../server/src/repositories/mongo.js';
export async function connect(){const config=loadConfig();await mongoose.connect(config.mongoUri,{serverSelectionTimeoutMS:10000,autoIndex:false});const hello=await mongoose.connection.db.admin().command({hello:1});if(!hello.setName&&hello.msg!=='isdbgrid')throw new Error('A MongoDB replica set or Atlas is required.');await initializeDatabase();return {config,repo:new MongoRepository(),close:()=>mongoose.disconnect()};}
