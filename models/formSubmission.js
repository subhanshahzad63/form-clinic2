// models/formSubmission.js
const mongoose = require("mongoose");

const formSubmissionSchema = new mongoose.Schema({
  userEmail: String,
  formType: String,
  userCustomId: String,   // <-- Add this field to store the 12-digit ID
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("FormSubmission", formSubmissionSchema);
