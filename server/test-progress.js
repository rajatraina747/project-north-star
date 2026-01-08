const pgp = require('pg-promise')();
const db = pgp('postgresql://northstar:northstar@localhost:5432/northstar');

async function insertTestProgress() {
  try {
    // Get user
    const user = await db.one('SELECT id FROM users LIMIT 1');
    console.log('User ID:', user.id);

    // Get books and their files
    const books = await db.manyOrNone(`
      SELECT b.id as book_id, bf.id as file_id
      FROM books b
      LEFT JOIN book_files bf ON b.id = bf.book_id
      LIMIT 2
    `);

    console.log('Books:', books);

    if (books.length > 0) {
      // Insert progress for first book (45% complete, last read yesterday)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      await db.none(`
        INSERT INTO reading_progress (user_id, book_id, book_file_id, progress_percent, last_read_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id, book_file_id)
        DO UPDATE SET progress_percent = $4, last_read_at = $5
      `, [user.id, books[0].book_id, books[0].file_id, 45, yesterday]);

      console.log('Inserted progress for book 1: 45%');
    }

    if (books.length > 1) {
      // Insert progress for second book (12% complete, last read 3 days ago)
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      await db.none(`
        INSERT INTO reading_progress (user_id, book_id, book_file_id, progress_percent, last_read_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id, book_file_id)
        DO UPDATE SET progress_percent = $4, last_read_at = $5
      `, [user.id, books[1].book_id, books[1].file_id, 12, threeDaysAgo]);

      console.log('Inserted progress for book 2: 12%');
    }

    console.log('Test progress data inserted successfully!');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    pgp.end();
  }
}

insertTestProgress();
