const mongoose = require("mongoose");

const formSubmissionSchema = new mongoose.Schema({
  userEmail: String,
  formType: String,
  userCustomId: String,  // Unique ID for tracking
  pdfUrl: String,  // Ensure this field exists for Cloudinary URL storage
  status: { 
    type: String, 
    enum: ["received", "signed", "approved"], 
    default: "received"  // Default to "received"
  },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("FormSubmission", formSubmissionSchema);
