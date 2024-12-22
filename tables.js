const mongoose = require("mongoose");
const { Row, BackupRow } = require("./server"); // Import models from server.js

// Replace the connection string with your actual MongoDB URI
const mongoURI = "mongodb+srv://seekho:admin@cluster0.eqodz2h.mongodb.net/pdf168";

async function resetDatabase() {
  try {
    // Connect to MongoDB
    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("Connected to MongoDB.");

    // Delete all documents from rows and backuprows collections
    const rowsDeleted = await Row.deleteMany({});
    const backupRowsDeleted = await BackupRow.deleteMany({});

    console.log(`Rows deleted: ${rowsDeleted.deletedCount}`);
    console.log(`Backup Rows deleted: ${backupRowsDeleted.deletedCount}`);

    console.log("Database reset completed. Both collections are now empty.");
  } catch (error) {
    console.error("Error resetting database:", error);
  } finally {
    // Close the database connection
    await mongoose.connection.close();
    console.log("Database connection closed.");
  }
}

resetDatabase();
