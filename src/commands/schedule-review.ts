import { resolve } from 'node:path';

import { AppError } from '../common/errors/app-error.js';
import { readScheduleImportFile } from '../modules/admin/schedule-csv.js';
import { reviewSchedule } from '../modules/admin/schedule-review.js';

async function main(): Promise<void> {
  const file = parseArguments(process.argv.slice(2));
  const rows = await readScheduleImportFile(resolve(file));
  const review = reviewSchedule(rows);
  console.log(JSON.stringify(review, null, 2));
  if (!review.readyForImport) process.exitCode = 1;
}

function parseArguments(arguments_: readonly string[]): string {
  const fileArguments = arguments_.filter((argument) => argument.startsWith('--file='));
  const fileArgument = fileArguments[0];
  if (
    fileArguments.length !== 1 ||
    fileArgument === undefined ||
    fileArgument.slice('--file='.length).trim() === '' ||
    arguments_.some((argument) => !argument.startsWith('--file='))
  ) {
    throw new AppError({
      code: 'REVIEW_ARGUMENTS_INVALID',
      message: 'Usage: npm run schedule:review -- --file=path/to/schedule.csv',
      statusCode: 400,
    });
  }
  return fileArgument.slice('--file='.length);
}

main().catch((error: unknown) => {
  if (error instanceof AppError) {
    console.error(
      JSON.stringify({
        error: { code: error.code, message: error.message, details: error.details },
      }),
    );
  } else {
    console.error(
      JSON.stringify({ error: { code: 'REVIEW_FAILED', message: 'Schedule review failed.' } }),
    );
  }
  process.exitCode = 1;
});
