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
  "mongodb+srv://seekho:admin@cluster0.eqodz2h.mongodb.net/pdf2222",
  {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    maxPoolSize: 10, // Corrected to use 'maxPoolSize'
  }
);

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
      mongoUrl: "mongodb+srv://seekho:admin@cluster0.eqodz2h.mongodb.net/pdf23",
    }),
    cookie: {
      maxAge: 30 * 60 * 1000, // 30 minutes
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
        req.session.userId = admin._id;   // Treat admin as a user for attendance access
        req.session.adminId = admin._id;  // Also mark as admin
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

    await page.close();

    // Send email with the generated PDF
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "dunstan.alpro@gmail.com",
        pass: "dute uook aral ptvk", // Use your app password
      },
    });

    const mailOptions = {
      from: "dunstan.alpro@gmail.com",
      to: "dunstan.alpro@gmail.com", // Update this if you want to send to user's email
      subject: "Your PDF Document",
      text: "Please find your generated PDF document attached.",
      attachments: [
        {
          filename: "document.pdf",
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

    await page.close();

    // Send email with the generated PDF
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "dunstan.alpro@gmail.com", // Replace with your email
        pass: "dute uook aral ptvk", // Use your app password
      },
    });

    const mailOptions = {
      from: "dunstan.alpro@gmail.com",
      to: "dunstan.alpro@gmail.com", // User's email from form data
      subject: "Your PDF Document",
      text: "Please find your generated PDF document attached.",
      attachments: [
        {
          filename: "document.pdf",
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

    await page.close();

    // Send email with the generated PDF
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "dunstan.alpro@gmail.com",
        pass: "dute uook aral ptvk", // Use your app password
      },
    });

    const mailOptions = {
      from: "dunstan.alpro@gmail.com",
      to: "alpro.clinicmetrocity@gmail.com", // User's email from form data
      subject: "Your PDF Document",
      text: "Please find your generated PDF document attached.",
      attachments: [
        {
          filename: "document.pdf",
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
});

const Row = mongoose.model("Row", rowSchema);

// Endpoint to get all rows
app.get("/api/rows", async (req, res) => {
  const rows = await Row.find({}).sort({ rowNumber: 1 });
  res.json(rows);
});

// Endpoint to get the last 15 rows
app.get("/api/rows/last15", async (req, res) => {
  const rows = await Row.find({}).sort({ rowNumber: -1 }).limit(15);
  res.json(rows.reverse()); // Reverse to get ascending order
});

// Endpoint to save a row
app.post("/api/rows", async (req, res) => {
  const {
    name,
    identificationNumber,
    treatmentDate,
    treatmentCost,
    patientSignature,
  } = req.body;

  // Find the current maximum rowNumber
  const lastRow = await Row.findOne({}).sort({ rowNumber: -1 });
  const rowNumber = lastRow ? lastRow.rowNumber + 1 : 1;

  const newRow = new Row({
    rowNumber,
    name,
    identificationNumber,
    treatmentDate,
    treatmentCost,
    patientSignature,
  });
  await newRow.save();
  res.json(newRow);
});

// New endpoint to handle email sending
app.post("/api/send-email", upload.single("pdf"), async (req, res) => {
  try {
    const pdfBuffer = req.file.buffer;
    console.log("pdf: ", pdfBuffer);

    // Set up Nodemailer transporter
    let transporter = nodemailer.createTransport({
      service: "gmail", // e.g., Gmail
      auth: {
        user: "dunstan.alpro@gmail.com",
        pass: "dute uook aral ptvk", // Use your app password
      },
    });

    // Set up email data
    let mailOptions = {
      from: "dunstan.alpro@gmail.com", // sender address
      to: "subhanshahzad2k@gmail.com,malikshahzaib606@gmail.com", // list of receivers
      subject: "Patient Data SCHB", // Subject line
      text: "Please find attached the Patient Data SCHB PDF.", // plain text body
      attachments: [
        {
          filename: "Patient_Data_SCHB.pdf",
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    };

    // Send mail
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
  rowNumber: Number,
  name: String,
  identificationNumber: String,
  treatmentDate: String,
  treatmentCost: String,
  patientSignature: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const BackupRow = mongoose.model("BackupRow", backupRowSchema);


// Endpoint to reset the database
app.post("/api/reset-rows", async (req, res) => {
  try {

    // Find all current rows
    const currentRows = await Row.find({}).sort({ rowNumber: 1 });
    
    // If there are rows, insert them into BackupRow collection for backup
    if (currentRows.length > 0) {
      await BackupRow.insertMany(currentRows);
    }
    // Delete all documents from the 'rows' collection
    await Row.deleteMany({});
    res.json({ message: "Database reset successful" });
  } catch (error) {
    console.error("Error resetting database:", error);
    res
      .status(500)
      .json({ error: "An error occurred while resetting the database." });
  }
});

// Serve the main form (index.html) only if the user is authenticated
app.get("/attendance", isUserAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "protected", "attendance.html"));
});

// Endpoint to delete a row by its rowNumber
app.delete("/api/rows/:rowNumber", async (req, res) => {
  try {
    const rowNumberToDelete = parseInt(req.params.rowNumber, 10);

    // Find the row by rowNumber
    const rowToDelete = await Row.findOne({ rowNumber: rowNumberToDelete });
    if (!rowToDelete) {
      return res.status(404).json({ message: "Row not found" });
    }

    // Delete the row
    await Row.deleteOne({ rowNumber: rowNumberToDelete });

    // Decrement rowNumber for all rows with rowNumber > rowNumberToDelete
    const rowsToUpdate = await Row.find({
      rowNumber: { $gt: rowNumberToDelete },
    }).sort({ rowNumber: 1 });

    for (const row of rowsToUpdate) {
      row.rowNumber = row.rowNumber - 1;
      await row.save();
    }

    res.json({ message: "Row deleted and rows reordered successfully" });
  } catch (error) {
    console.error("Error deleting row:", error);
    res
      .status(500)
      .json({ message: "An error occurred while deleting the row." });
  }
});


// Check if current session belongs to admin
app.get("/api/is-admin", (req, res) => {
  // If adminId is set in session, user is admin
  const isAdmin = !!req.session.adminId;
  res.json({ isAdmin });
});


// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
