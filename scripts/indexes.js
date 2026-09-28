import {connect} from './database.js';
const {close}=await connect();console.log('Collections, indexes and atomic request counters are initialized.');await close();
