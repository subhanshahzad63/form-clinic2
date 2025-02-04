require('dotenv').config(); // Load environment variables first
const express = require("express");
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");
const mongoose = require("mongoose");
const session = require("express-session");
const Admin = require("./models/admin"); // Admin model
const User = require("./models/User"); // User model (ensure the filename is 'user.js')
const multer = require("multer");
const MongoStore = require("connect-mongo");
const jspdf = require("jspdf"); // Ensure this is imported at the top
const { endOfMonth } = require("date-fns"); // optional helper, or do manual logic
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary (place this after your other middleware)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});


const storage = multer.memoryStorage();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024, // Set the maximum size to 8 MB (or whatever size you need)
  },
});

const app = express();
const PORT = process.env.PORT || 3001;

// MongoDB Connection
mongoose.connect(
  "mongodb+srv://seekho:admin@cluster0.eqodz2h.mongodb.net/pdf168",
  {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    maxPoolSize: 10, // Corrected to use 'maxPoolSize'
  }
);

const FormSubmission = require("./models/formSubmission");

// Middleware
app.use(bodyParser.json({ limit: "100mb" }));
app.use(express.static("public"));
app.use("/assets", express.static(path.join(__dirname, "assets")));

app.use(
  session({
    secret: "yourSecretKey",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl:
        "mongodb+srv://seekho:admin@cluster0.eqodz2h.mongodb.net/pdf168",
    }),
    cookie: {
      maxAge: 5 * 24 * 60 * 60 * 1000,
    },
  })
);

// Middleware to check if user is authenticated
function isUserAuthenticated(req, res, next) {
  if (req.session.userId) {
    return next();
  }
  // Save the original URL in the session
  req.session.redirectTo = req.originalUrl;
  return res.redirect("/login"); // Redirect to login page
}

// Serve the login page
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// Handle user login
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    // First, try to find a user
    let user = await User.findOne({ email, password });

    if (user) {
      // If user found, set user session
      req.session.userId = user._id;
    } else {
      // If no user found, try to find an admin
      const admin = await Admin.findOne({ email, password });
      if (admin) {
        // If admin found, set both userId and adminId so isUserAuthenticated passes
        req.session.userId = admin._id; // Treat admin as a user for attendance access
        req.session.adminId = admin._id; // Also mark as admin
      } else {
        // No user or admin found
        return res.status(401).json({ message: "Invalid email or password" });
      }
    }

    // Redirect logic remains same
    const redirectTo = req.session.redirectTo || "/";
    delete req.session.redirectTo;
    res.json({ message: "Login successful", redirect: redirectTo });
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).json({ message: "Server error" });
  }
});

let browser; // Declare globally

// User logout
app.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).send("Could not log out");
    }
    res.redirect("/login");
  });
});

//File 1: Clinic

// Serve the main form (index.html) only if the user is authenticated
app.get("/clinic", isUserAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "protected", "clinic.html"));
});

// Route to serve index.html for Puppeteer without authentication
app.get("/pdf-form", (req, res) => {
  // Allow access only from localhost (Puppeteer)
  const ip = req.connection.remoteAddress;
  if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") {
    res.sendFile(path.join(__dirname, "protected", "clinic.html"));
  } else {
    res.status(403).send("Forbidden");
  }
});

 
// ------------------------------------
// Updated PDF Generation Functionality
// ------------------------------------
app.post("/download-pdf", isUserAuthenticated, async (req, res) => {
  if (!req.session.userId) {
    return res
      .status(401)
      .json({ error: "Session expired. Please log in again." });
  }

  try {

    const currentUser = await User.findById(req.session.userId);
    if (!currentUser) {
      return res.status(404).json({ error: "User not found" });
    }

    const { customId } = req.body;


    // 2) Insert a doc in FormSubmission with formType = "clinic"
   
    // Destructure the selectedStamp from req.body
    const {
      applicantName,
      idNumber,
      phoneNumber,
      occupation,
      income,
      familyMembers,
      finalIncome,
      signatureDate,
      signature,
      idCardFront,
      idCardBack,
      goldCardFront,
      goldCardBack,
      email,
      jum,
      selectedStamp, // Added this line
    } = req.body;

    // List of allowed stamps to validate the input
    const allowedStamps = [
      "albert",
      "chan",
      "chumang",
      "jarek",
      "jong",
      "rushdi",
      "saat",
      "amir",
      "jempai",
      "lai",
      "sunani",
    ];

    // Validate the selectedStamp
    if (!allowedStamps.includes(selectedStamp)) {
      return res.status(400).json({ error: "Invalid stamp selected." });
    }

    // Function to approximate size of Base64 data in bytes
    const getFileSize = (base64String) => {
      if (!base64String) return 0;
      let padding =
        base64String.slice(-2) === "=="
          ? 2
          : base64String.slice(-1) === "="
            ? 1
            : 0;
      return (base64String.length * 3) / 4 - padding;
    };

    // Define maximum file size (8 MB in bytes)
    const maxFileSize = 8 * 1024 * 1024;

    // Validate the size of uploaded images
    const idCardFrontSize = getFileSize(idCardFront);
    const idCardBackSize = getFileSize(idCardBack);
    const goldCardFrontSize = getFileSize(goldCardFront);
    const goldCardBackSize = getFileSize(goldCardBack);

    if (
      idCardFrontSize > maxFileSize ||
      idCardBackSize > maxFileSize ||
      (goldCardFrontSize && goldCardFrontSize > maxFileSize) ||
      (goldCardBackSize && goldCardBackSize > maxFileSize)
    ) {
      return res.status(400).json({
        error: "One or more uploaded files exceed the 8 MB size limit.",
      });
    }

    const outputDir = path.join(__dirname, "output");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }

    // Remove random stamp selection logic
    // const images = ["1.png", "2.png", "3.png", "4.png", "5.png", "6.png"];
    // const selectedImage = images[Math.floor(Math.random() * images.length)];
    // const imagePath = `http://localhost:${PORT}/assets/${selectedImage}`;

    // Use the selectedStamp to set the image path
    const imagePath = `http://localhost:${PORT}/assets/${selectedStamp}.png`;

    // Check if the image file exists
    const stampFilePath = path.join(
      __dirname,
      "assets",
      `${selectedStamp}.png`
    );
    if (!fs.existsSync(stampFilePath)) {
      return res
        .status(400)
        .json({ error: "Stamp image not found on server." });
    }

    // Launch Puppeteer and generate the PDF
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT}/pdf-form`, {
      waitUntil: "networkidle0",
    });

    // Pass the selectedStamp and imagePath to the page.evaluate function
    await page.evaluate(
      async (
        applicantName,
        idNumber,
        phoneNumber,
        occupation,
        income,
        familyMembers,
        finalIncome,
        signatureDate,
        signature,
        idCardFront,
        idCardBack,
        goldCardFront,
        goldCardBack,
        imagePath,
        jum
      ) => {
        // Populate applicant details
        document.querySelector('input[placeholder="Enter name"]').value =
          applicantName;
        document.querySelector('input[placeholder="Enter ID number"]').value =
          idNumber;
        document.querySelector(
          'input[placeholder="Enter phone number"]'
        ).value = phoneNumber;
        document.querySelector('input[placeholder="Enter occupation"]').value =
          occupation;
        document.querySelector('input[placeholder="Amount"]').value = income;

        // Populate family members section
        familyMembers.forEach((familyMember, index) => {
          document.querySelectorAll(".family-name")[index].value =
            familyMember.name;
          document.querySelectorAll(".family-occupation")[index].value =
            familyMember.occupation;
          document.querySelectorAll(".family-income")[index].value =
            familyMember.income;
        });

        document.querySelector("#rm-jum").value = jum;

        // Populate additional inputs
        document.querySelector(".final-income").value = finalIncome;
        document.querySelector(".signature-date").value = signatureDate;

        // Append the signature image to the correct container
        const signatureContainer =
          document.getElementById("signatureContainer");
        const signatureImage = document.createElement("img");
        signatureImage.src = signature;
        signatureImage.style.width = "150px";
        signatureImage.style.height = "50px";
        signatureContainer.innerHTML = ""; // Clear the canvas
        signatureContainer.appendChild(signatureImage); // Add the image in the correct place

        // Set the hidden image and wait for it to load
        const imageElement = document.querySelector(".hidden-pdf-image");
        if (imageElement) {
          imageElement.src = imagePath;
          await new Promise((resolve, reject) => {
            imageElement.onload = resolve;
            imageElement.onerror = reject;
          });
        }

        // Set the uploaded images (ID and Gold Card) if they exist
        if (idCardFront) {
          const frontImageElement =
            document.getElementById("displayIdCardFront");
          frontImageElement.src = idCardFront;
          document.getElementById("uploadedImages").style.display = "block";
          await new Promise((resolve, reject) => {
            frontImageElement.onload = resolve;
            frontImageElement.onerror = reject;
          });
        } else {
          document
            .querySelector(".displayIdCardFront")
            .closest("div").style.display = "none";
        }

        if (idCardBack) {
          const backImageElement = document.getElementById("displayIdCardBack");
          backImageElement.src = idCardBack;
          document.getElementById("uploadedImages").style.display = "block";
          await new Promise((resolve, reject) => {
            backImageElement.onload = resolve;
            backImageElement.onerror = reject;
          });
        } else {
          document
            .querySelector(".displayIdCardBack")
            .closest("div").style.display = "none";
        }

        if (goldCardFront) {
          const goldFrontImageElement = document.getElementById(
            "displayGoldCardFront"
          );
          goldFrontImageElement.src = goldCardFront;
          document.querySelector(".gold-card").style.display = "flex";
          await new Promise((resolve, reject) => {
            goldFrontImageElement.onload = resolve;
            goldFrontImageElement.onerror = reject;
          });
        } else {
          document
            .querySelector(".displayGoldCardFront")
            .closest("div").style.display = "none";
        }

        if (goldCardBack) {
          const goldBackImageElement = document.getElementById(
            "displayGoldCardBack"
          );
          goldBackImageElement.src = goldCardBack;
          document.querySelector(".gold-card").style.display = "flex";
          await new Promise((resolve, reject) => {
            goldBackImageElement.onload = resolve;
            goldBackImageElement.onerror = reject;
          });
        } else {
          document
            .querySelector(".displayGoldCardBack")
            .closest("div").style.display = "none";
        }
      },
      applicantName,
      idNumber,
      phoneNumber,
      occupation,
      income,
      familyMembers,
      finalIncome,
      signatureDate,
      signature,
      idCardFront,
      idCardBack,
      goldCardFront,
      goldCardBack,
      imagePath, // Ensure imagePath is passed
      jum
    );

    // Generate the PDF after ensuring the signature and uploaded images are included
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      height: "59.4cm", // 29.7cm (A4 height) * 2 for exactly two pages
      pageRanges: "1-2", // This limits the output to pages 1 and 2 only
    });

    const pdfPath = path.join(__dirname, "output", "generated-document.pdf");
    fs.writeFileSync(pdfPath, pdf);

    const safeName = applicantName.replace(/[^a-z0-9]/gi, "_");


    const uniqueFileName = `${safeName}_${Date.now()}`;


    // Upload to Cloudinary - ADD THIS SECTION
    const cloudinaryResponse = await cloudinary.uploader.upload(pdfPath, {
      folder: "clinic_pdf_documents",
      resource_type: "raw",
      public_id: uniqueFileName,
    });

    await FormSubmission.create({
      userEmail: currentUser.email,
      formType: "clinic",
      userCustomId: customId,
      pdfUrl: cloudinaryResponse.secure_url,  // Store Cloudinary link
      status: "received",  // Default status when uploaded
    });

    

    await page.close();

    // Send email with the generated PDF
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "dunstan.alpro@gmail.com",
        pass: "qufj jazt fafb mypw", // Use your app password
      },
    });


    const mailOptions = {
      from: "dunstan.alpro@gmail.com",
      // to: "subhanshahzad2k@gmail.com", // list of receivers
      to: "dunstan.alpro@gmail.com,amc.clinicmiri@gmail.com", // Update this if you want to send to user's email
      // to: "", // Update this if you want to send to user's email
      subject: "schb application",
      text: "Please find your generated PDF document attached.",
      attachments: [
        {
          filename: safeName + ".pdf",
          path: pdfPath,
        },
      ],
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error("Error sending email:", error);
        return res.status(500).send("Error sending email");
      }
      console.log("Email sent:", info.response);
      res.json({
        message: "PDF generated, saved, and emailed",
        link: "/download-server-pdf",
        cloudinaryUrl: cloudinaryResponse.secure_url,
      });
    });
  } catch (error) {
    console.error("Error generating PDF:", error.message, error.stack);
    res.status(500).send("Error generating PDF");
  } finally {
    if (browser) {
      await browser.close(); // Ensure browser is always closed
    }
  }
});

//file 2: Simple

// Serve the main form (index2.html) only if the user is authenticated
app.get("/", isUserAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "protected", "index.html"));
});

// Route to serve index2.html for Puppeteer without authentication
app.get("/pdf-form2", (req, res) => {
  // Allow access only from localhost (Puppeteer)
  const ip = req.connection.remoteAddress;
  if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") {
    res.sendFile(path.join(__dirname, "protected", "index.html"));
  } else {
    res.status(403).send("Forbidden");
  }
});

app.post("/download-pdf2", isUserAuthenticated, async (req, res) => {
  if (!req.session.userId) {
    return res
      .status(401)
      .json({ error: "Session expired. Please log in again." });
  }

  try {

    const currentUser = await User.findById(req.session.userId);
    if (!currentUser) {
      return res.status(404).json({ error: "User not found" });
    }

    const { customId } = req.body;


    // 2) Insert a doc with formType = "index"
  
    const {
      applicantName,
      idNumber,
      phoneNumber,
      occupation,
      income,
      familyMembers,
      finalIncome,
      signatureDate,
      signature,
      idCardFront,
      idCardBack,
      goldCardFront,
      goldCardBack,
      email,
      jum,
    } = req.body;

    // Function to calculate the size of base64 data in bytes
    const getFileSize = (base64String) => {
      if (!base64String) return 0;
      let padding =
        base64String.slice(-2) === "=="
          ? 2
          : base64String.slice(-1) === "="
            ? 1
            : 0;
      return (base64String.length * 3) / 4 - padding;
    };

    // Define maximum file size (8 MB in bytes)
    const maxFileSize = 8 * 1024 * 1024;

    // Validate the size of uploaded images
    const idCardFrontSize = getFileSize(idCardFront);
    const idCardBackSize = getFileSize(idCardBack);
    const goldCardFrontSize = getFileSize(goldCardFront);
    const goldCardBackSize = getFileSize(goldCardBack);

    if (
      idCardFrontSize > maxFileSize ||
      idCardBackSize > maxFileSize ||
      (goldCardFrontSize && goldCardFrontSize > maxFileSize) ||
      (goldCardBackSize && goldCardBackSize > maxFileSize)
    ) {
      return res.status(400).json({
        error: "One or more uploaded files exceed the 8 MB size limit.",
      });
    }

    const outputDir = path.join(__dirname, "output");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }

    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT}/pdf-form2`, {
      waitUntil: "networkidle0",
    });

    await page.evaluate(
      async (
        applicantName,
        idNumber,
        phoneNumber,
        occupation,
        income,
        familyMembers,
        finalIncome,
        signatureDate,
        signature,
        idCardFront,
        idCardBack,
        goldCardFront,
        goldCardBack,
        jum
      ) => {
        // Populate applicant details
        document.querySelector('input[placeholder="Enter name"]').value =
          applicantName;
        document.querySelector('input[placeholder="Enter ID number"]').value =
          idNumber;
        document.querySelector(
          'input[placeholder="Enter phone number"]'
        ).value = phoneNumber;
        document.querySelector('input[placeholder="Enter occupation"]').value =
          occupation;
        document.querySelector('input[placeholder="Amount"]').value = income;

        // Populate family members section
        familyMembers.forEach((familyMember, index) => {
          document.querySelectorAll(".family-name")[index].value =
            familyMember.name;
          document.querySelectorAll(".family-occupation")[index].value =
            familyMember.occupation;
          document.querySelectorAll(".family-income")[index].value =
            familyMember.income;
        });

        document.querySelector("#rm-jum").value = jum;

        // Populate additional inputs
        document.querySelector(".final-income").value = finalIncome;
        document.querySelector(".signature-date").value = signatureDate;

        // Append the signature image to the correct container
        const signatureContainer =
          document.getElementById("signatureContainer");
        const signatureImage = document.createElement("img");
        signatureImage.src = signature;
        signatureImage.style.width = "150px";
        signatureImage.style.height = "50px";
        signatureContainer.innerHTML = ""; // Clear the canvas
        signatureContainer.appendChild(signatureImage); // Add the image in the correct place

        document.querySelector(".approval-section").style.display = "block";

        // Set the uploaded images (ID and Gold Card) if they exist
        if (idCardFront) {
          const frontImageElement =
            document.getElementById("displayIdCardFront");
          frontImageElement.src = idCardFront;
          document.getElementById("uploadedImages").style.display = "block";
          await new Promise((resolve, reject) => {
            frontImageElement.onload = resolve;
            frontImageElement.onerror = reject;
          });
        } else {
          document
            .querySelector(".displayIdCardFront")
            .closest("div").style.display = "none";
        }

        if (idCardBack) {
          const backImageElement = document.getElementById("displayIdCardBack");
          backImageElement.src = idCardBack;
          document.getElementById("uploadedImages").style.display = "block";
          await new Promise((resolve, reject) => {
            backImageElement.onload = resolve;
            backImageElement.onerror = reject;
          });
        } else {
          document
            .querySelector(".displayIdCardBack")
            .closest("div").style.display = "none";
        }

        if (goldCardFront) {
          const goldFrontImageElement = document.getElementById(
            "displayGoldCardFront"
          );
          goldFrontImageElement.src = goldCardFront;
          document.querySelector(".gold-card").style.display = "flex";
          await new Promise((resolve, reject) => {
            goldFrontImageElement.onload = resolve;
            goldFrontImageElement.onerror = reject;
          });
        } else {
          document
            .querySelector(".displayGoldCardFront")
            .closest("div").style.display = "none";
        }

        if (goldCardBack) {
          const goldBackImageElement = document.getElementById(
            "displayGoldCardBack"
          );
          goldBackImageElement.src = goldCardBack;
          document.querySelector(".gold-card").style.display = "flex";
          await new Promise((resolve, reject) => {
            goldBackImageElement.onload = resolve;
            goldBackImageElement.onerror = reject;
          });
        } else {
          document
            .querySelector(".displayGoldCardBack")
            .closest("div").style.display = "none";
        }
      },
      applicantName,
      idNumber,
      phoneNumber,
      occupation,
      income,
      familyMembers,
      finalIncome,
      signatureDate,
      signature,
      idCardFront,
      idCardBack,
      goldCardFront,
      goldCardBack,
      jum
    );

    // Generate the PDF after ensuring the signature and uploaded images are included
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      height: "59.4cm", // 29.7cm (A4 height) * 2 for exactly two pages
      pageRanges: "1-2", // This limits the output to pages 1 and 2 only
    });

    const pdfPath = path.join(__dirname, "output", "generated-document.pdf");
    fs.writeFileSync(pdfPath, pdf);

    const safeName = applicantName.replace(/[^a-z0-9]/gi, "_");


    const uniqueFileName = `${safeName}_${Date.now()}`;


    const cloudinaryResponse = await cloudinary.uploader.upload(pdfPath, {
      folder: "normal_pdf_documents",
      resource_type: "raw",
      public_id: uniqueFileName,
    });

    await FormSubmission.create({
      userEmail: currentUser.email,
      formType: "index",
      userCustomId: customId,
      pdfUrl: cloudinaryResponse.secure_url,  // Store Cloudinary link
      status: "received",  // Default status when uploaded
    });

     // Update FormSubmission with Cloudinary URL - ADD THIS
    

    await page.close();

    // Send email with the generated PDF
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "dunstan.alpro@gmail.com", // Replace with your email
        pass: "qufj jazt fafb mypw", // Use your app password
      },
    });


    const mailOptions = {
      from: "dunstan.alpro@gmail.com",
      to: "dunstan.alpro@gmail.com,amc.clinicmiri@gmail.com,QMRBV1@alpropharmacy.com,QMRJP1@alpropharmacy.com,QMRMJ1@alpropharmacy.com,qmrlb1.alphac@gmail.com,QMRPJ1@alpropharmacy.com,QMRPL1@alpropharmacy.com,qkc3m1@alpropharmacy.com,qkc7m1@alpropharmacy.com,QKCBK1@alpropharmacy.com,QKCHS1@alpropharmacy.com,QKCMC1@alpropharmacy.com,qkcmj1@alpropharmacy.com,QKCNB1@alpropharmacy.com,qkcp11@alpropharmacy.com,QKCPS1@alpropharmacy.com,QKCSR1@alpropharmacy.com,QKCST1@alpropharmacy.com,qkctj1@alpropharmacy.com,qbtj51@alpropharmacy.com,QBTJK1@alpropharmacy.com,QBTMJ1@alpropharmacy.com,QBTPC1@alpropharmacy.com,QBTSB1@alpropharmacy.com,QSAJHF@alpropharmacy.com,QSBDT1@alpropharmacy.com,QSBFL1@alpropharmacy.com,QSBJC1@alpropharmacy.com,QSBPJ1@alpropharmacy.com,QSBPW1@alpropharmacy.com,QSKAR1@alpropharmacy.com,QSRST1@alpropharmacy.com",
      // to:"subhanshahzad2k@gmail.com",
      subject: "schb application",
      text: "Please find your generated PDF document attached.",
      attachments: [
        {
          filename: safeName + ".pdf",
          path: pdfPath,
        },
      ],
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error("Error sending email:", error);
        return res.status(500).send("Error sending email");
      }
      console.log("Email sent:", info.response);
      res.json({
        message: "PDF generated, saved, and emailed",
        link: "/download-server-pdf",
        cloudinaryUrl: cloudinaryResponse.secure_url,
      });
    });
  } catch (error) {
    console.error("Error generating PDF:", error.message, error.stack);
    res.status(500).send("Error generating PDF");
  } finally {
    if (browser) {
      await browser.close(); // Ensure browser is always closed
    }
  }
});

//file 3 : Kuching

// Serve the main form (index2.html) only if the user is authenticated
app.get("/kuching", isUserAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "protected", "kuching.html"));
});

// Route to serve index2.html for Puppeteer without authentication
app.get("/pdf-form3", (req, res) => {
  // Allow access only from localhost (Puppeteer)
  const ip = req.connection.remoteAddress;
  if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") {
    res.sendFile(path.join(__dirname, "protected", "kuching.html"));
  } else {
    res.status(403).send("Forbidden");
  }
});

app.post("/download-pdf3", isUserAuthenticated, async (req, res) => {
  if (!req.session.userId) {
    return res
      .status(401)
      .json({ error: "Session expired. Please log in again." });
  }

  try {


    const {
      applicantName,
      idNumber,
      phoneNumber,
      occupation,
      income,
      familyMembers,
      finalIncome,
      signatureDate,
      signature,
      idCardFront,
      idCardBack,
      goldCardFront,
      goldCardBack,
      email,
      jum,
    } = req.body;

    // Function to calculate the size of base64 data in bytes
    const getFileSize = (base64String) => {
      if (!base64String) return 0;
      let padding =
        base64String.slice(-2) === "=="
          ? 2
          : base64String.slice(-1) === "="
            ? 1
            : 0;
      return (base64String.length * 3) / 4 - padding;
    };

    // Define maximum file size (8 MB in bytes)
    const maxFileSize = 8 * 1024 * 1024;

    // Validate the size of uploaded images
    const idCardFrontSize = getFileSize(idCardFront);
    const idCardBackSize = getFileSize(idCardBack);
    const goldCardFrontSize = getFileSize(goldCardFront);
    const goldCardBackSize = getFileSize(goldCardBack);

    if (
      idCardFrontSize > maxFileSize ||
      idCardBackSize > maxFileSize ||
      (goldCardFrontSize && goldCardFrontSize > maxFileSize) ||
      (goldCardBackSize && goldCardBackSize > maxFileSize)
    ) {
      return res.status(400).json({
        error: "One or more uploaded files exceed the 8 MB size limit.",
      });
    }

    const outputDir = path.join(__dirname, "output");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }

    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT}/pdf-form3`, {
      waitUntil: "networkidle0",
    });

    const currentUser = await User.findById(req.session.userId);
    if (!currentUser) {
      return res.status(404).json({ error: "User not found" });
    }

    const { customId } = req.body;


    // 2) Insert a doc with formType = "kuching"
  

    await page.evaluate(
      async (
        applicantName,
        idNumber,
        phoneNumber,
        occupation,
        income,
        familyMembers,
        finalIncome,
        signatureDate,
        signature,
        idCardFront,
        idCardBack,
        goldCardFront,
        goldCardBack,
        jum
      ) => {
        // Populate applicant details
        document.querySelector('input[placeholder="Enter name"]').value =
          applicantName;
        document.querySelector('input[placeholder="Enter ID number"]').value =
          idNumber;
        document.querySelector(
          'input[placeholder="Enter phone number"]'
        ).value = phoneNumber;
        document.querySelector('input[placeholder="Enter occupation"]').value =
          occupation;
        document.querySelector('input[placeholder="Amount"]').value = income;

        // Populate family members section
        familyMembers.forEach((familyMember, index) => {
          document.querySelectorAll(".family-name")[index].value =
            familyMember.name;
          document.querySelectorAll(".family-occupation")[index].value =
            familyMember.occupation;
          document.querySelectorAll(".family-income")[index].value =
            familyMember.income;
        });

        document.querySelector("#rm-jum").value = jum;

        // Populate additional inputs
        document.querySelector(".final-income").value = finalIncome;
        document.querySelector(".signature-date").value = signatureDate;

        // Append the signature image to the correct container
        const signatureContainer =
          document.getElementById("signatureContainer");
        const signatureImage = document.createElement("img");
        signatureImage.src = signature;
        signatureImage.style.width = "150px";
        signatureImage.style.height = "50px";
        signatureContainer.innerHTML = ""; // Clear the canvas
        signatureContainer.appendChild(signatureImage); // Add the image in the correct place

        // Make approval section visible
        document.querySelector(".approval-section").style.display = "block";

        // Set the uploaded images (ID and Gold Card) if they exist
        if (idCardFront) {
          const frontImageElement =
            document.getElementById("displayIdCardFront");
          frontImageElement.src = idCardFront;
          document.getElementById("uploadedImages").style.display = "block";
          await new Promise((resolve, reject) => {
            frontImageElement.onload = resolve;
            frontImageElement.onerror = reject;
          });
        } else {
          document
            .querySelector(".displayIdCardFront")
            .closest("div").style.display = "none";
        }

        if (idCardBack) {
          const backImageElement = document.getElementById("displayIdCardBack");
          backImageElement.src = idCardBack;
          document.getElementById("uploadedImages").style.display = "block";
          await new Promise((resolve, reject) => {
            backImageElement.onload = resolve;
            backImageElement.onerror = reject;
          });
        } else {
          document
            .querySelector(".displayIdCardBack")
            .closest("div").style.display = "none";
        }

        if (goldCardFront) {
          const goldFrontImageElement = document.getElementById(
            "displayGoldCardFront"
          );
          goldFrontImageElement.src = goldCardFront;
          document.querySelector(".gold-card").style.display = "flex";
          await new Promise((resolve, reject) => {
            goldFrontImageElement.onload = resolve;
            goldFrontImageElement.onerror = reject;
          });
        } else {
          document
            .querySelector(".displayGoldCardFront")
            .closest("div").style.display = "none";
        }

        if (goldCardBack) {
          const goldBackImageElement = document.getElementById(
            "displayGoldCardBack"
          );
          goldBackImageElement.src = goldCardBack;
          document.querySelector(".gold-card").style.display = "flex";
          await new Promise((resolve, reject) => {
            goldBackImageElement.onload = resolve;
            goldBackImageElement.onerror = reject;
          });
        } else {
          document
            .querySelector(".displayGoldCardBack")
            .closest("div").style.display = "none";
        }
      },
      applicantName,
      idNumber,
      phoneNumber,
      occupation,
      income,
      familyMembers,
      finalIncome,
      signatureDate,
      signature,
      idCardFront,
      idCardBack,
      goldCardFront,
      goldCardBack,
      jum
    );

    // Generate the PDF after ensuring the signature and uploaded images are included
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      height: "59.4cm", // 29.7cm (A4 height) * 2 for exactly two pages
      pageRanges: "1-2", // This limits the output to pages 1 and 2 only
    });

    const pdfPath = path.join(__dirname, "output", "generated-document.pdf");
    fs.writeFileSync(pdfPath, pdf);

    const safeName = applicantName.replace(/[^a-z0-9]/gi, "_");


    const uniqueFileName = `${safeName}_${Date.now()}`;


    const cloudinaryResponse = await cloudinary.uploader.upload(pdfPath, {
      folder: "kuching_pdf_documents",
      resource_type: "raw",
      public_id: uniqueFileName,
    });

    await FormSubmission.create({
      userEmail: currentUser.email,
      formType: "kuching",
      userCustomId: customId,
      pdfUrl: cloudinaryResponse.secure_url,  // Store Cloudinary link
      status: "received",  // Default status when uploaded
    });

     // Update FormSubmission with Cloudinary URL - ADD THIS
     

    await page.close();

    // Send email with the generated PDF
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "dunstan.alpro@gmail.com",
        pass: "qufj jazt fafb mypw", // Use your app password
      },
    });


    const mailOptions = {
      from: "dunstan.alpro@gmail.com",
      to: "alpro.clinicmetrocity@gmail.com,amc.clinicmiri@gmail.com", // User's email from form data
      // to: "subhanshahzad2k@gmail.com", // User's email from form data
      subject: "schb application",
      text: "Please find your generated PDF document attached.",
      attachments: [
        {
          filename: safeName + ".pdf",
          path: pdfPath,
        },
      ],
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error("Error sending email:", error);
        return res.status(500).send("Error sending email");
      }
      console.log("Email sent:", info.response);
      res.json({
        message: "PDF generated, saved, and emailed",
        link: "/download-server-pdf",
        cloudinaryUrl: cloudinaryResponse.secure_url,
      });
    });
  } catch (error) {
    console.error("Error generating PDF:", error.message, error.stack);
    res.status(500).send("Error generating PDF");
  } finally {
    if (browser) {
      await browser.close(); // Ensure browser is always closed
    }
  }
});



//storage system

// Serve the storage page only if the admin is authenticated
app.get("/admin/storage", isAdminAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "protected", "storage.html"));
});


// API endpoint to fetch files from Cloudinary storage with optional month filtering
// API endpoint to fetch all files from Cloudinary storage with optional month filtering
app.get("/api/admin/storage", isAdminAuthenticated, async (req, res) => {
  try {
    const { month } = req.query;

    // Fetch all form submissions from MongoDB
    const formSubmissions = await FormSubmission.find();

    // Define folders
    const folders = [
      "normal_pdf_documents",
      "clinic_pdf_documents",
      "kuching_pdf_documents",
    ];

    // Function to fetch Cloudinary files
    const fetchResources = async (folder) => {
      const resources = await cloudinary.api.resources({
        type: "upload",
        resource_type: "raw",
        prefix: `${folder}/`,
        max_results: 500,
      });

      let filteredResources = resources.resources;
      if (month) {
        const [year, monthNumber] = month.split("-").map(Number);
        filteredResources = filteredResources.filter((file) => {
          const fileDate = new Date(file.created_at);
          return fileDate.getFullYear() === year && fileDate.getMonth() + 1 === monthNumber;
        });
      }

      return filteredResources.map((file) => {
        // Find the corresponding document from MongoDB
        const matchedSubmission = formSubmissions.find((doc) => doc.pdfUrl === file.secure_url);
        
        return {
          public_id: file.public_id,
          url: file.secure_url,
          created_at: file.created_at,
          format: file.format,
          resource_type: file.resource_type,
          folder: folder,
          status: matchedSubmission ? matchedSubmission.status : "received",  // Default to "received"
        };
      });
    };

    // Fetch resources from all folders
    const [normalFiles, clinicFiles, kuchingFiles] = await Promise.all(folders.map(fetchResources));

    const allFiles = [...normalFiles, ...clinicFiles, ...kuchingFiles];

    // Sort files by upload date (newest first)
    allFiles.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({ all_pdf_documents: allFiles });
  } catch (error) {
    console.error("Error fetching files from Cloudinary:", error);
    res.status(500).json({ message: "Error fetching storage data." });
  }
});


app.post("/api/admin/update-status", isAdminAuthenticated, async (req, res) => {
  try {
    const { pdfUrl, status } = req.body;

    // Validate status
    if (!["received", "signed", "approved"].includes(status)) {
      return res.status(400).json({ message: "Invalid status value." });
    }

    // Find and update the document
    const updatedSubmission = await FormSubmission.findOneAndUpdate(
      { pdfUrl: pdfUrl }, // Find by Cloudinary URL
      { status: status },  // Update status
      { new: true }
    );

    if (!updatedSubmission) {
      return res.status(404).json({ message: "Document not found." });
    }

    res.json({ message: "Status updated successfully.", updatedSubmission });
  } catch (error) {
    console.error("Error updating status:", error);
    res.status(500).json({ message: "Error updating status." });
  }
});


// ------------------------------------
// Admin and User Management Functionality
// ------------------------------------

// Admin Login
app.post("/admin/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const admin = await Admin.findOne({ email, password });
    if (!admin) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    req.session.adminId = admin._id;
    res.json({ message: "Login successful" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// Middleware to check if admin is authenticated
function isAdminAuthenticated(req, res, next) {
  if (req.session.adminId) {
    return next();
  }
  res.redirect("/admin");
}

// Admin Dashboard
app.get("/admin/dashboard", isAdminAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-dashboard.html"));
});

app.get("/admin-attendance-monthly", isAdminAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "protected", "admin-attendance-monthly.html"));
});


app.get("/admin-attendance-daily", isAdminAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "protected", "admin-attendance-daily.html"));
});

app.get("/admin-attendance-monthly-kuching", isAdminAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "protected", "admin-attendance-monthly-kuching.html"));
});


app.get("/admin-attendance-daily-kuching", isAdminAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "protected", "admin-attendance-daily-kuching.html"));
});

// Get all users (Data fetched dynamically for the dashboard)
app.get("/admin/users-data", isAdminAuthenticated, async (req, res) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: "Error fetching users" });
  }
});

// Logout Route for Admin
app.post("/admin/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).send("Could not log out");
    } else {
      res.redirect("/admin");
    }
  });
});

// Create a new user
app.post("/admin/users", isAdminAuthenticated, async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = new User({ email, password });
    await user.save();
    res.json({ message: "User created successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error creating user" });
  }
});

// Update a user
app.put("/admin/users/:id", isAdminAuthenticated, async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  try {
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.password = password;
    await user.save();
    res.json({ message: "User updated successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error updating user" });
  }
});

// Delete a user
app.delete("/admin/users/:id", isAdminAuthenticated, async (req, res) => {
  const { id } = req.params;
  try {
    await User.findByIdAndDelete(id);
    res.json({ message: "User deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting user" });
  }
});

// Admin login page
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// ------------------------------------
// Existing Route for Downloading PDF
// ------------------------------------

// Route to serve the saved PDF for download
app.get("/download-server-pdf", (req, res) => {
  const filePath = path.join(__dirname, "output", "generated-document.pdf");
  res.download(filePath, "document.pdf", (err) => {
    if (err) {
      console.error("Error downloading PDF:", err);
    }
  });
});

const rowSchema = new mongoose.Schema({
  rowNumber: Number,
  name: String,
  identificationNumber: String,
  treatmentDate: String,
  treatmentCost: String,
  patientSignature: String,
  userEmail: String, // <--- new
  userCustomId: String,     // <--- NEW FIELD for the person's 12-digit ID

  createdAt: { type: Date, default: Date.now }, // Add createdAt field
});

const Row = mongoose.model("Row", rowSchema);

// Endpoint to get all rows
app.get("/api/rows", async (req, res) => {
  try {
    const rows = await Row.find({}).sort({ createdAt: 1 }); // Sort by createdAt
    res.json(rows);
  } catch (error) {
    console.error("Error fetching rows:", error);
    res.status(500).json({ message: "Error fetching rows", error });
  }
});


app.get("/api/kuching-rows", async (req, res) => {
  try {
    const rows = await KuchingRow.find({}).sort({ createdAt: 1 });
    res.json(rows);
  } catch (error) {
    console.error("Error fetching Kuching rows:", error);
    res.status(500).json({ message: "Error fetching Kuching rows", error });
  }
});

// Endpoint to get the last 15 rows
app.get("/api/rows/last15", async (req, res) => {
  try {
    const rows = await Row.find({}).sort({ createdAt: -1 }).limit(15);
    res.json(rows.reverse()); // Reverse to return in ascending order
  } catch (error) {
    console.error("Error fetching last 15 rows:", error);
    res.status(500).json({ message: "Error fetching rows", error });
  }
});

app.get("/api/kuching-rows/last15", async (req, res) => {
  try {
    const rows = await KuchingRow.find({}).sort({ createdAt: -1 }).limit(15);
    res.json(rows.reverse()); // Return in ascending order
  } catch (error) {
    console.error("Error fetching last 15 Kuching rows:", error);
    res.status(500).json({ message: "Error fetching rows", error });
  }
});

// Endpoint to save a row
app.post("/api/rows", async (req, res) => {
  const {
    name,
    identificationNumber,
    treatmentDate,
    treatmentCost,
    patientSignature,
    userCustomId,  // <--- We'll accept this from the request body now
  } = req.body;

  try {
    // Lookup the user's email
    const currentUser = await User.findById(req.session.userId);
    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const userEmail = currentUser.email;
    // Find the current maximum rowNumber
    const lastRow = await Row.findOne({}).sort({ rowNumber: -1 });
    const rowNumber = lastRow ? lastRow.rowNumber + 1 : 1;

    // Create and save the new row
    const newRow = new Row({
      rowNumber,
      name,
      identificationNumber,
      treatmentDate,
      treatmentCost,
      patientSignature,
      userEmail, // store the user’s email
      userCustomId,   // <--- store that ID

    });

    await newRow.save();

    // Create a backup row using the saved newRow's data
    const backupRow = new BackupRow({
      originalRowId: newRow._id, // store a direct reference
      rowNumber: newRow.rowNumber,
      name: newRow.name,
      identificationNumber: newRow.identificationNumber,
      treatmentDate: newRow.treatmentDate,
      treatmentCost: newRow.treatmentCost,
      patientSignature: newRow.patientSignature,
      userEmail: newRow.userEmail,    // same userEmail
      userCustomId: newRow.userCustomId,  // <--- store it in backup too
      createdAt: newRow.createdAt, // Use the createdAt from newRow
    });

    await backupRow.save();

    res.json(newRow);
  } catch (error) {
    console.error("Error saving row:", error);
    res.status(500).json({ message: "Error saving row", error });
  }
});


app.post("/api/kuching-rows", async (req, res) => {
  const {
    name,
    identificationNumber,
    treatmentDate,
    treatmentCost,
    patientSignature,
    userCustomId,
  } = req.body;

  try {
    // Check current user from session
    const currentUser = await User.findById(req.session.userId);
    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }
    const userEmail = currentUser.email;

    // 1) Find the current max rowNumber
    const lastRow = await KuchingRow.findOne({}).sort({ rowNumber: -1 });
    const rowNumber = lastRow ? lastRow.rowNumber + 1 : 1;

    // 2) Create and save the new row
    const newRow = new KuchingRow({
      rowNumber,
      name,
      identificationNumber,
      treatmentDate,
      treatmentCost,
      patientSignature,
      userEmail,
      userCustomId,
    });
    await newRow.save();

    // 3) Create a backup
    const backupRow = new KuchingBackupRow({
      originalRowId: newRow._id,
      rowNumber: newRow.rowNumber,
      name: newRow.name,
      identificationNumber: newRow.identificationNumber,
      treatmentDate: newRow.treatmentDate,
      treatmentCost: newRow.treatmentCost,
      patientSignature: newRow.patientSignature,
      userEmail: newRow.userEmail,
      userCustomId: newRow.userCustomId,
      createdAt: newRow.createdAt,
    });
    await backupRow.save();

    res.json(newRow);
  } catch (error) {
    console.error("Error saving Kuching row:", error);
    res.status(500).json({ message: "Error saving Kuching row", error });
  }
});

// New endpoint to handle email sending
app.post("/api/send-email", upload.single("pdf"), async (req, res) => {
  try {
    // 1) The PDF buffer from the front-end
    const pdfBuffer = req.file.buffer;
    console.log("pdf: ", pdfBuffer);

    // 2) Find or create the PdfCounter doc
    let pdfCounter = await PdfCounter.findOne({});
    if (!pdfCounter) {
      pdfCounter = new PdfCounter({ sequenceValue: 0 });
    }

    // 3) Increment the sequence
    pdfCounter.sequenceValue += 1;
    await pdfCounter.save();

    // 4) Build the filename from the new global number
    const pdfNumber = pdfCounter.sequenceValue;
    const pdfFilename = `PatientData${pdfNumber}.pdf`;

    // 5) Set up Nodemailer transporter
    let transporter = nodemailer.createTransport({
      service: "gmail", // or whichever service you're using
      auth: {
        user: "dunstan.alpro@gmail.com",
        pass: "qufj jazt fafb mypw", // your app password
      },
    });

    // 6) Set up email data with the new filename
    let mailOptions = {
      from: "dunstan.alpro@gmail.com",
      // to: "subhanshahzad2k@gmail.com",
      to: "dunstan.alpro@gmail.com,amc.clinicmiri@gmail.com",
      subject: "Patient Data SCHB",
      text: "Please find attached the Patient Data SCHB PDF.",
      attachments: [
        {
          filename: pdfFilename, // e.g. "PatientData1.pdf", "PatientData2.pdf", ...
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    };

    // 7) Send mail
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.log("Error sending email:", error);
        return res.status(500).json({ message: "Error sending email", error });
      }
      console.log("Message sent: %s", info.messageId);
      res.json({ message: "Email sent successfully", info });
    });
  } catch (error) {
    console.error("Error in /api/send-email:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
});

const backupRowSchema = new mongoose.Schema({
  originalRowId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Row", // optional if you want Mongoose to treat it as a real "ref"
  },
  rowNumber: Number,
  name: String,
  identificationNumber: String,
  treatmentDate: String,
  treatmentCost: String,
  patientSignature: String,
  userEmail: String, // <--- new
  userCustomId: String,    // <--- SAME FIELD here too

  createdAt: {
    type: Date,
    default: Date.now,
  },
});


// ==================================
// 1) Kuching Attendance Schemas
// ==================================
const kuchingRowSchema = new mongoose.Schema({
  rowNumber: Number,
  name: String,
  identificationNumber: String,
  treatmentDate: String,
  treatmentCost: String,
  patientSignature: String,
  userEmail: String,
  userCustomId: String,
  createdAt: { type: Date, default: Date.now },
});

const kuchingBackupRowSchema = new mongoose.Schema({
  originalRowId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "KuchingRow",
  },
  rowNumber: Number,
  name: String,
  identificationNumber: String,
  treatmentDate: String,
  treatmentCost: String,
  patientSignature: String,
  userEmail: String,
  userCustomId: String,
  createdAt: { type: Date, default: Date.now },
});

// Models
const KuchingRow = mongoose.model("KuchingRow", kuchingRowSchema);
const KuchingBackupRow = mongoose.model("KuchingBackupRow", kuchingBackupRowSchema);


// pdfCounterSchema.js (or in the same file as other models)
const pdfCounterSchema = new mongoose.Schema({
  sequenceValue: {
    type: Number,
    required: true,
    default: 0,
  },
});

const PdfCounter = mongoose.model("PdfCounter", pdfCounterSchema);

const BackupRow = mongoose.model("BackupRow", backupRowSchema);

// Endpoint to reset the database
app.post("/api/reset-rows", async (req, res) => {
  try {
    const currentRows = await Row.find({}).sort({ createdAt: 1 }); // Get rows from `Row`

    if (currentRows.length > 0) {
      // Filter rows to insert only those not already in `BackupRow`
      for (const row of currentRows) {
        const exists = await BackupRow.findOne({ createdAt: row.createdAt });
        if (!exists) {
          await BackupRow.create(row); // Add only if it doesn't exist
        }
      }
    }

    // Clear the `Row` collection after backup
    await Row.deleteMany({});
    res.json({
      message: "Database reset successful and no duplicates added to BackupRow",
    });
  } catch (error) {
    console.error("Error resetting database:", error);
    res
      .status(500)
      .json({ error: "An error occurred while resetting the database." });
  }
});

app.post("/api/kuching/reset-rows", async (req, res) => {
  try {
    const currentRows = await KuchingRow.find({}).sort({ createdAt: 1 });

    if (currentRows.length > 0) {
      for (const row of currentRows) {
        const exists = await KuchingBackupRow.findOne({ createdAt: row.createdAt });
        if (!exists) {
          await KuchingBackupRow.create(row.toObject()); 
        }
      }
    }

    // Clear the `KuchingRow` collection after backup
    await KuchingRow.deleteMany({});
    res.json({
      message: "Kuching DB reset successful and no duplicates added to KuchingBackupRow",
    });
  } catch (error) {
    console.error("Error resetting Kuching DB:", error);
    res.status(500).json({
      error: "An error occurred while resetting the Kuching DB.",
    });
  }
});

// Serve the main form (index.html) only if the user is authenticated
app.get("/attendance", isUserAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "protected", "attendance-board.html"));
});

// Serve the main form (index.html) only if the user is authenticated
app.get("/attendance-miri", isUserAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "protected", "attendance.html"));
});

app.get("/attendance-kuching", isUserAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "protected", "attendance-kuching.html"));
});

// server.js
app.delete("/api/rows/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // 1) Find the row in BackupRow by its _id
    const backupDoc = await BackupRow.findById(id);
    if (!backupDoc) {
      return res.status(404).json({ message: "Backup row not found" });
    }

    // 2) Delete from BackupRow
    await BackupRow.deleteOne({ _id: id });

    // 3) If new data => backupDoc.originalRowId is set
    if (backupDoc.originalRowId) {
      // Just remove from Row using that _id
      await Row.deleteOne({ _id: backupDoc.originalRowId });
      return res.json({ message: "Row deleted from both Row & BackupRow" });
    }

    // 4) If older data => fallback match in Row. 
    //    For instance, match on rowNumber + createdAt (or more fields).
    //    This is not 100% foolproof, but good enough if rowNumber+createdAt are unique.
    const fallbackDoc = await Row.findOne({
      rowNumber: backupDoc.rowNumber,
      createdAt: backupDoc.createdAt,
      name: backupDoc.name, // optionally
      // identificationNumber: backupDoc.identificationNumber, // optionally
    });

    if (fallbackDoc) {
      await Row.deleteOne({ _id: fallbackDoc._id });
      return res.json({
        message: "Row deleted via fallback match from both Row & BackupRow",
      });
    } else {
      // Not found in Row (maybe it was never there or was already reset)
      return res.json({
        message:
          "Row deleted from BackupRow. No matching doc found in Row (fallback).",
      });
    }
  } catch (error) {
    console.error("Error deleting row:", error);
    res
      .status(500)
      .json({ message: "An error occurred while deleting the row.", error });
  }
});

// ==================================
// 6) Delete a Kuching Row
// ==================================
app.delete("/api/kuching-rows/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // 1) Find the row in KuchingBackupRow by _id
    const backupDoc = await KuchingBackupRow.findById(id);
    if (!backupDoc) {
      return res.status(404).json({ message: "Kuching backup row not found" });
    }

    // 2) Delete from KuchingBackupRow
    await KuchingBackupRow.deleteOne({ _id: id });

    // 3) If new data => backupDoc.originalRowId is set
    if (backupDoc.originalRowId) {
      // remove from KuchingRow
      await KuchingRow.deleteOne({ _id: backupDoc.originalRowId });
      return res.json({ message: "Row deleted from KuchingRow & KuchingBackupRow" });
    }

    // 4) Fallback match if older data
    const fallbackDoc = await KuchingRow.findOne({
      rowNumber: backupDoc.rowNumber,
      createdAt: backupDoc.createdAt,
      name: backupDoc.name,
    });

    if (fallbackDoc) {
      await KuchingRow.deleteOne({ _id: fallbackDoc._id });
      return res.json({
        message: "Row deleted via fallback from both KuchingRow & KuchingBackupRow",
      });
    } else {
      return res.json({
        message: "Row deleted from KuchingBackupRow. No matching doc found in KuchingRow (fallback).",
      });
    }
  } catch (error) {
    console.error("Error deleting Kuching row:", error);
    res.status(500).json({ message: "Error deleting row", error });
  }
});


app.post("/api/admin/generate-fake-data", async (req, res) => {
  try {
    let dummyData = [];
    for (let i = 1; i <= 30; i++) {
      dummyData.push({
        name: `Auto Test ${i}`,
        identificationNumber: `IC${i}`,
        treatmentDate: "2024-01-21T10:00:00Z",
        treatmentCost: 100 + i,
        patientSignature: "data:image/png;base64,FAKE",
        createdAt: new Date("2024-12-21T10:00:00Z"),
      });
    }
    const result = await BackupRow.insertMany(dummyData);
    res.json({ insertedCount: result.insertedCount });
  } catch (err) {
    console.error("Error generating data:", err);
    res.status(500).json({ message: "Could not generate data." });
  }
});

// Check if current session belongs to admin
app.get("/api/is-admin", (req, res) => {
  // If adminId is set in session, user is admin
  const isAdmin = !!req.session.adminId;
  res.json({ isAdmin });
});


app.get("/admin/form-leaderboard", isAdminAuthenticated, (req, res) => {
  // Adjust path if you place leaderboard.html elsewhere
  res.sendFile(path.join(__dirname, "protected", "leaderboard-form.html"));
});

// GET /api/admin/leaderboard

// Updated API endpoint to fetch form submissions with optional month filtering
app.get("/api/admin/form-leaderboard", isAdminAuthenticated, async (req, res) => {
  try {
    const { month } = req.query; // Expecting format 'YYYY-MM'

    let filter = {};

    if (month) {
      // Parse the 'YYYY-MM' format
      const [year, monthNumber] = month.split('-').map(Number);

      // Validate month and year
      if (
        isNaN(year) ||
        isNaN(monthNumber) ||
        monthNumber < 1 ||
        monthNumber > 12
      ) {
        return res.status(400).json({ message: "Invalid month format." });
      }

      // Create Date objects for the start and end of the selected month
      const startDate = new Date(year, monthNumber - 1, 1);
      const endDate = new Date(year, monthNumber, 1);

      // Assuming 'createdAt' is a Date field in FormSubmission
      filter.createdAt = { $gte: startDate, $lt: endDate };
    }

    // Retrieve form submissions with the applied filter
    const submissions = await FormSubmission.find(filter);
    res.json(submissions);
  } catch (error) {
    console.error("Error fetching form submissions:", error);
    return res.status(500).json({ message: "Error fetching submissions." });
  }
});

app.get("/admin/attendance-leaderboard", isAdminAuthenticated, (req, res) => {
  // Adjust path if you place `leaderboard-attendance.html` elsewhere
  res.sendFile(path.join(__dirname, "protected", "leaderboard-attendance.html"));
});

app.get("/admin/attendance-leaderboard-kuching", isAdminAuthenticated, (req, res) => {
  // Adjust path if you place `leaderboard-attendance.html` elsewhere
  res.sendFile(path.join(__dirname, "protected", "leaderboard-attendance-kuching.html"));
});


// 2) API endpoint to fetch backup rows (attendance data)
app.get("/api/admin/attendance-leaderboard", isAdminAuthenticated, async (req, res) => {
  try {
    const { month } = req.query; // Expecting format 'YYYY-MM'

    let filter = {};

    if (month) {
      // Parse the 'YYYY-MM' format
      const [year, monthNumber] = month.split('-').map(Number);

      // Create Date objects for the start and end of the selected month
      const startDate = new Date(year, monthNumber - 1, 1);
      const endDate = new Date(year, monthNumber, 1);

      // Assuming 'createdAt' is a Date field
      filter.createdAt = { $gte: startDate, $lt: endDate };
    }

    // Retrieve backup rows with the applied filter
    const backupRows = await BackupRow.find(filter);
    res.json(backupRows);
  } catch (error) {
    console.error("Error fetching backup rows:", error);
    return res.status(500).json({ message: "Error fetching attendance data." });
  }
});

// ==================================
// 7) GET /api/admin/kuching-leaderboard?month=YYYY-MM
// ==================================
app.get("/api/admin/kuching-leaderboard", isAdminAuthenticated, async (req, res) => {
  try {
    const { month } = req.query;
    let filter = {};

    if (month) {
      const [year, monthNumber] = month.split("-").map(Number);
      const startDate = new Date(year, monthNumber - 1, 1);
      const endDate = new Date(year, monthNumber, 1);
      filter.createdAt = { $gte: startDate, $lt: endDate };
    }

    const backupRows = await KuchingBackupRow.find(filter);
    res.json(backupRows);
  } catch (error) {
    console.error("Error fetching Kuching data:", error);
    res.status(500).json({ message: "Error fetching Kuching data." });
  }
});




app.get("/api/backup-rows", async (req, res) => {
  try {
    const rows = await BackupRow.find({}).sort({ createdAt: 1 }); // Sort by createdAt
    res.json(rows);
  } catch (error) {
    console.error("Error fetching backup rows:", error);
    res.status(500).json({ message: "Error fetching rows", error });
  }
});
// GET /api/admin/sheets?year=2024&month=12&page=1
app.get("/api/admin/msheets", isAdminAuthenticated, async (req, res) => {
  const { year, month, page = 1 } = req.query;
  const rowsPerPage = 15;

  console.log("Received request with parameters:", { year, month, page });

  try {
    const query = {};

    if (year && month) {
      // Convert year/month to numeric
      const numericYear = parseInt(year, 10);
      const numericMonth = parseInt(month, 10);

      if (!numericYear || !numericMonth || numericMonth < 1 || numericMonth > 12) {
        console.error("Invalid year/month provided:", { year, month });
        return res
          .status(400)
          .json({ message: "Invalid year or month format provided" });
      }

      // 1) Calculate first day of that month (UTC-based)
      // e.g. new Date(2024, 11, 1) => Dec 1, 2024 (because month is 0-index)
      const startOfMonth = new Date(Date.UTC(numericYear, numericMonth - 1, 1, 0, 0, 0, 0));

      // 2) Calculate end-of-month
      //    A quick approach: 
      //      - create date for next month, day=1, minus 1ms
      const startOfNextMonth = new Date(Date.UTC(numericYear, numericMonth, 1, 0, 0, 0, 0));
      const endOfMonth = new Date(startOfNextMonth.getTime() - 1);
      // Or you can use a library like date-fns `endOfMonth(startOfMonth)`

      console.log("startOfMonth =>", startOfMonth.toISOString());
      console.log("endOfMonth =>", endOfMonth.toISOString());

      // 3) Build the query
      query.createdAt = {
        $gte: startOfMonth,
        $lte: endOfMonth,
      };
    } else {
      console.log("No year/month provided; returning no rows.");
      return res.json({
        rows: [],
        pagination: {
          currentPage: parseInt(page, 10),
          totalPages: 0,
        },
      });
    }

    // 4) With that query, do pagination
    const rows = await BackupRow.find(query)
      .sort({ createdAt: 1 })
      .skip((page - 1) * rowsPerPage)
      .limit(rowsPerPage);

    const totalRows = await BackupRow.countDocuments(query);
    const totalPages = Math.ceil(totalRows / rowsPerPage);

    console.log("Fetched rows from database:", rows);
    console.log("Pagination details:", {
      currentPage: parseInt(page, 10),
      totalPages,
      totalRows,
    });

    res.json({
      rows,
      pagination: {
        currentPage: parseInt(page, 10),
        totalPages,
      },
    });
  } catch (error) {
    console.error("Error fetching sheets (month-based):", error);
    res.status(500).json({ message: "Error fetching month-based sheets", error });
  }
});

app.get("/api/admin/kuching/msheets", isAdminAuthenticated, async (req, res) => {
  const { year, month, page = 1 } = req.query;
  const rowsPerPage = 15;

  console.log("Received request with parameters:", { year, month, page });

  try {
    const query = {};

    if (year && month) {
      // Convert year/month to numeric
      const numericYear = parseInt(year, 10);
      const numericMonth = parseInt(month, 10);

      if (!numericYear || !numericMonth || numericMonth < 1 || numericMonth > 12) {
        console.error("Invalid year/month provided:", { year, month });
        return res
          .status(400)
          .json({ message: "Invalid year or month format provided" });
      }

      // 1) Calculate first day of that month (UTC-based)
      // e.g. new Date(2024, 11, 1) => Dec 1, 2024 (because month is 0-index)
      const startOfMonth = new Date(Date.UTC(numericYear, numericMonth - 1, 1, 0, 0, 0, 0));

      // 2) Calculate end-of-month
      //    A quick approach: 
      //      - create date for next month, day=1, minus 1ms
      const startOfNextMonth = new Date(Date.UTC(numericYear, numericMonth, 1, 0, 0, 0, 0));
      const endOfMonth = new Date(startOfNextMonth.getTime() - 1);
      // Or you can use a library like date-fns `endOfMonth(startOfMonth)`

      console.log("startOfMonth =>", startOfMonth.toISOString());
      console.log("endOfMonth =>", endOfMonth.toISOString());

      // 3) Build the query
      query.createdAt = {
        $gte: startOfMonth,
        $lte: endOfMonth,
      };
    } else {
      console.log("No year/month provided; returning no rows.");
      return res.json({
        rows: [],
        pagination: {
          currentPage: parseInt(page, 10),
          totalPages: 0,
        },
      });
    }

    // 4) With that query, do pagination
    const rows = await KuchingBackupRow.find(query)
      .sort({ createdAt: 1 })
      .skip((page - 1) * rowsPerPage)
      .limit(rowsPerPage);

    const totalRows = await KuchingBackupRow.countDocuments(query);
    const totalPages = Math.ceil(totalRows / rowsPerPage);

    console.log("Fetched rows from database:", rows);
    console.log("Pagination details:", {
      currentPage: parseInt(page, 10),
      totalPages,
      totalRows,
    });

    res.json({
      rows,
      pagination: {
        currentPage: parseInt(page, 10),
        totalPages,
      },
    });
  } catch (error) {
    console.error("Error fetching sheets (month-based):", error);
    res.status(500).json({ message: "Error fetching month-based sheets", error });
  }
});

app.get("/api/admin/sheets", isAdminAuthenticated, async (req, res) => {
  const { date, page = 1 } = req.query; // Optional date filter and pagination
  const rowsPerPage = 15;

  console.log("Received request with parameters:", { date, page });

  try {
    const query = {};

    if (date) {
      // Validate the date format
      const utcDate = new Date(date);

      if (isNaN(utcDate.getTime())) {
        console.error("Invalid date provided:", date);
        return res
          .status(400)
          .json({ message: "Invalid date format provided" });
      }

      // Calculate start and end of the day in UTC
      const startOfDay = new Date(
        Date.UTC(
          utcDate.getFullYear(),
          utcDate.getMonth(),
          utcDate.getDate(),
          0,
          0,
          0,
          0
        )
      );
      const endOfDay = new Date(
        Date.UTC(
          utcDate.getFullYear(),
          utcDate.getMonth(),
          utcDate.getDate(),
          23,
          59,
          59,
          999
        )
      );

      query.createdAt = {
        $gte: startOfDay,
        $lte: endOfDay,
      };

      console.log("Constructed query for date filter (UTC):", query);
    } else {
      console.log("No date filter applied; returning no rows.");
      return res.json({
        rows: [],
        pagination: {
          currentPage: parseInt(page, 10),
          totalPages: 0,
        },
      });
    }

    const rows = await BackupRow.find(query)
      .sort({ createdAt: 1 })
      .skip((page - 1) * rowsPerPage)
      .limit(rowsPerPage);

    const totalRows = await BackupRow.countDocuments(query);
    const totalPages = Math.ceil(totalRows / rowsPerPage);

    console.log("Fetched rows from database:", rows);
    console.log("Pagination details:", {
      currentPage: parseInt(page, 10),
      totalPages,
      totalRows,
    });

    res.json({
      rows,
      pagination: {
        currentPage: parseInt(page, 10),
        totalPages,
      },
    });
  } catch (error) {
    console.error("Error fetching sheets:", error);
    res.status(500).json({ message: "Error fetching sheets", error });
  }
});


app.get("/api/admin/kuching/sheets", isAdminAuthenticated, async (req, res) => {
  const { date, page = 1 } = req.query; // Optional date filter and pagination
  const rowsPerPage = 15;

  console.log("Received request with parameters:", { date, page });

  try {
    const query = {};

    if (date) {
      // Validate the date format
      const utcDate = new Date(date);

      if (isNaN(utcDate.getTime())) {
        console.error("Invalid date provided:", date);
        return res
          .status(400)
          .json({ message: "Invalid date format provided" });
      }

      // Calculate start and end of the day in UTC
      const startOfDay = new Date(
        Date.UTC(
          utcDate.getFullYear(),
          utcDate.getMonth(),
          utcDate.getDate(),
          0,
          0,
          0,
          0
        )
      );
      const endOfDay = new Date(
        Date.UTC(
          utcDate.getFullYear(),
          utcDate.getMonth(),
          utcDate.getDate(),
          23,
          59,
          59,
          999
        )
      );

      query.createdAt = {
        $gte: startOfDay,
        $lte: endOfDay,
      };

      console.log("Constructed query for date filter (UTC):", query);
    } else {
      console.log("No date filter applied; returning no rows.");
      return res.json({
        rows: [],
        pagination: {
          currentPage: parseInt(page, 10),
          totalPages: 0,
        },
      });
    }

    const rows = await KuchingBackupRow.find(query)
      .sort({ createdAt: 1 })
      .skip((page - 1) * rowsPerPage)
      .limit(rowsPerPage);

    const totalRows = await KuchingBackupRow.countDocuments(query);
    const totalPages = Math.ceil(totalRows / rowsPerPage);

    console.log("Fetched rows from database:", rows);
    console.log("Pagination details:", {
      currentPage: parseInt(page, 10),
      totalPages,
      totalRows,
    });

    res.json({
      rows,
      pagination: {
        currentPage: parseInt(page, 10),
        totalPages,
      },
    });
  } catch (error) {
    console.error("Error fetching sheets:", error);
    res.status(500).json({ message: "Error fetching sheets", error });
  }
});

app.post("/api/admin/send-pdf", isAdminAuthenticated, async (req, res) => {
  const { sheetId, date } = req.body;

  try {
    console.log("Received request:", { sheetId, date });

    let rows;
    if (sheetId) {
      rows = await BackupRow.find({ sheetId }).sort({ createdAt: 1 });
    } else if (date) {
      const startOfDay = new Date(date);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      rows = await BackupRow.find({
        createdAt: { $gte: startOfDay, $lte: endOfDay },
      }).sort({ createdAt: 1 });
    } else {
      return res.status(400).json({ message: "sheetId or date is required" });
    }

    if (!rows || rows.length === 0) {
      return res
        .status(404)
        .json({ message: "No rows found for the given sheet or date" });
    }

    const pdf = new jspdf.jsPDF();
    rows.forEach((row, index) => {
      pdf.text(`Row ${index + 1}:`, 10, 10 + index * 10);
      pdf.text(`Name: ${row.name}`, 10, 20 + index * 10);
      pdf.text(`ID: ${row.identificationNumber}`, 10, 30 + index * 10);
      pdf.text(`Date: ${row.treatmentDate}`, 10, 40 + index * 10);
      pdf.text(`Cost: RM ${row.treatmentCost}`, 10, 50 + index * 10);

      if (index < rows.length - 1) {
        pdf.addPage();
      }
    });

    const pdfBuffer = pdf.output("arraybuffer");

    // Set up Nodemailer transporter
    let transporter = nodemailer.createTransport({
      service: "gmail", // e.g., Gmail
      auth: {
        user: "dunstan.alpro@gmail.com",
        pass: "qufj jazt fafb mypw", // Use your app password
      },
    });

    // Set up email data
    let mailOptions = {
      from: "dunstan.alpro@gmail.com", // sender address
      to: "dunstan.alpro@gmail.com,amc.clinicmiri@gmail.com", // list of receivers
      // to: "subhanshahzad2k@gmail.com", // list of receivers
      subject: "Patient Data SCHB", // Subject line
      text: "Please find attached the Patient Data SCHB PDF.", // plain text body
      attachments: [
        {
          filename: "Patient_Data_SCHB.pdf",
          content: Buffer.from(pdfBuffer),
          contentType: "application/pdf",
        },
      ],
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error("Error sending email:", error);
        return res.status(500).json({ message: "Error sending email", error });
      }
      res.json({ message: "Email sent successfully", info });
    });
  } catch (error) {
    console.error("Error generating PDF:", error);
    res.status(500).json({ message: "Error generating PDF", error });
  }
});

app.get("/api/admin/backup-rows", isAdminAuthenticated, async (req, res) => {
  const { page = 1, date } = req.query;
  const rowsPerPage = 15;

  try {
    const query = {};
    if (date) {
      const startOfDay = new Date(date);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      query.createdAt = { $gte: startOfDay, $lte: endOfDay };
    }

    const rows = await BackupRow.find(query)
      .sort({ createdAt: 1 })
      .skip((page - 1) * rowsPerPage)
      .limit(rowsPerPage);

    const totalRows = await BackupRow.countDocuments(query);
    const totalPages = Math.ceil(totalRows / rowsPerPage);

    res.json({
      rows,
      pagination: {
        currentPage: page,
        totalPages,
      },
    });
  } catch (error) {
    console.error("Error fetching backup rows:", error);
    res.status(500).json({ message: "Error fetching rows", error });
  }
});

// server.js (or wherever you define your bulk-pdf route)
// server.js (or wherever bulk-pdf route is defined)
app.post("/api/admin/bulk-pdf", async (req, res) => {
  try {
    const { year, month } = req.body;
    if (!year || !month) {
      return res.status(400).json({ error: "Missing year or month" });
    }

    // 1) Calculate how many days in that year-month
    const firstDay = new Date(+year, +month - 1, 1);
    const lastDay = endOfMonth(firstDay); // e.g. 2024-12-31
    const totalDays = lastDay.getDate();

    console.log(
      `\n[bulk-pdf] From ${year}-${month}-01 to ${year}-${month}-${totalDays}`
    );

    // 2) Launch Puppeteer
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();

    // 2a) Log in as admin
    await page.goto("http://localhost:3001/admin", {
      waitUntil: "networkidle0",
    });
    await page.type("#adminEmail", "admin@gmail.com");
    await page.type("#adminPassword", "12345678");
    await page.click("#adminBtn");
    await page.waitForNavigation({ waitUntil: "networkidle0" });

    // 2b) Go to admin-attendance page
    await page.goto("http://localhost:3001/admin-attendance", {
      waitUntil: "networkidle0",
    });

    // 3) For each day in [1..totalDays]:
    for (let day = 1; day <= totalDays; day++) {
      const dayStr = String(day).padStart(2, "0"); // e.g. "01", "02"
      const desiredDate = `${year}-${month}-${dayStr}`;
      console.log(`\n[Info] Handling date: ${desiredDate}`);

      // 3a) Evaluate in the DOM: set #sheetDate, call filterByDate()
      await page.evaluate((dateValue) => {
        const dateField = document.getElementById("sheetDate");
        if (dateField) {
          dateField.value = dateValue;
          // This triggers the same filter as if user clicked
          filterByDate();
        }
      }, desiredDate);

      // 3b) *Wait* for the GET request to /api/admin/sheets?page=1&date=xxx
      //     Then parse its JSON. If totalPages=0 => skip
      const sheetsResponse = await page.waitForResponse((resp) => {
        const url = resp.url();
        return url.includes("/api/admin/sheets") && url.includes("page=1");
      });

      // 3c) Parse JSON
      const sheetsData = await sheetsResponse.json();
      const { pagination } = sheetsData;
      if (!pagination || pagination.totalPages === 0) {
        console.log(
          `[Info] No data for ${desiredDate} (totalPages=0). Skipping email.`
        );
        // Possibly the page might still show "No data" rows, so let's skip to next day
        continue;
      }

      // 4) There's data => we handle all pages. We’ll do a loop until Next is disabled
      let currentPage = 1;
      while (true) {
        console.log(
          `Date: ${desiredDate}, Page: ${currentPage} => generating PDF via exportAndEmail()`
        );

        // 4a) Wait for the /api/send-email call to respond
        await Promise.all([
          page.waitForResponse(
            (resp) => resp.url().endsWith("/api/send-email") && resp.ok()
          ),
          page.evaluate(() => {
            // Calls your front-end function that does html2canvas+jspdf+POST /api/send-email
            exportAndEmail();
          }),
        ]);

        console.log(`Page ${currentPage} done & emailed for ${desiredDate}.`);

        // 4b) Check if Next is present and not disabled
        const nextIsDisabled = await page.evaluate(() => {
          const nextBtn = Array.from(document.querySelectorAll("button")).find(
            (b) => b.innerText.includes("Next")
          );
          if (!nextBtn) return true; // means there's no Next button
          return nextBtn.disabled; // if disabled => no more pages
        });

        if (nextIsDisabled) {
          console.log(
            `No next page or next is disabled for ${desiredDate}. Done for this date.`
          );
          break;
        } else {
          // 4c) Click Next & wait for the next GET /api/admin/sheets call
          await Promise.all([
            page.waitForResponse((resp) =>
              resp.url().includes("/api/admin/sheets")
            ),
            page.evaluate(() => {
              const nextBtn = Array.from(
                document.querySelectorAll("button")
              ).find((b) => b.innerText.includes("Next"));
              if (nextBtn) nextBtn.click();
            }),
          ]);

          currentPage++;
        }
      } // end while
    } // end day loop

    // 5) All days done
    await browser.close();
    return res.json({ message: `Bulk PDF done for entire ${year}-${month}` });
  } catch (err) {
    console.error("Error in bulk PDF route:", err);
    return res
      .status(500)
      .json({ error: "Something went wrong generating PDFs" });
  }
});
module.exports = { Row, BackupRow };

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
