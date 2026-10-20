import {validatePilotEnv} from './pilot-env.mjs';
const errors = validatePilotEnv(process.env);
if (errors.length) {
  console.error('Pilot configuration needs attention (values are not printed):');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else console.log('Pilot environment shape passed. Provider credentials, hosted migrations and OAuth settings still need live verification.');
