import { TwitterUserAuth } from './auth-user';

const auth = new TwitterUserAuth();

await auth.login(process.argv[2], process.argv[3]);
