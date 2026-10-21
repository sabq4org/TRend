import { migrate } from './migrate';

const url = process.env.DATABASE_ADMIN_URL;
if (!url) {
  console.error('DATABASE_ADMIN_URL is required');
  process.exit(1);
}

migrate(url)
  .then(({ applied, skipped }) => {
    console.log(
      `applied: ${applied.length ? applied.join(', ') : '—'} | up to date: ${skipped.length}`,
    );
  })
  .catch((e: Error) => {
    console.error(e.message);
    process.exit(1);
  });
