const puppeteer = require("puppeteer");
const path = require("path");
const fs = require("fs");

async function runTest() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const routes = [
    { url: "http://localhost:3001/", formSelector: "#downloadBtn" },
    { url: "http://localhost:3001/clinic", formSelector: "#downloadBtn" },
    { url: "http://localhost:3001/kuching", formSelector: "#downloadBtn" },
  ];

  async function login(page) {
    await page.goto("http://localhost:3001/login", { waitUntil: "networkidle2" });
    
    // Fill in the login form
    await page.type('input[name="email"]', "a@gmail.com");
    await page.type('input[name="password"]', "123");
    
    // Submit the form
    await page.click('button[type="submit"]');
    
    // Wait for navigation after login
    await page.waitForNavigation({ waitUntil: "networkidle2" });
    
    console.log("Logged in successfully!");
  }

  for (let i = 0; i < 15; i++) {
    for (const route of routes) {
      const page = await browser.newPage();
      console.log(`Testing route: ${route.url}`);

      try {
        // Log in to the system
        await login(page);

        // Navigate to the target route after logging in
        await page.goto(route.url, { waitUntil: "networkidle2", timeout: 20000 });

        // Wait for the form fields to be visible
        await page.waitForSelector('input[placeholder="Enter name"]', {
          visible: true,
          timeout: 10000,
        });

        // Fill the form
        await page.type('input[placeholder="Enter name"]', `Test User ${i + 1}`);
        await page.type('input[placeholder="Enter ID number"]', `ID${i + 1}123`);
        await page.type('input[placeholder="Enter phone number"]', "0123456789");
        await page.type('input[placeholder="Enter occupation"]', "Engineer");
        await page.type('input[placeholder="Amount"]', "5000");

        // Handle family members' details
        const familyNames = await page.$$eval(
          ".family-name",
          (inputs) => inputs.map((input, index) => `Family Member ${index + 1}`)
        );
        const familyOccupations = await page.$$eval(
          ".family-occupation",
          (inputs) => inputs.map((input, index) => `Occupation ${index + 1}`)
        );
        const familyIncomes = await page.$$eval(
          ".family-income",
          (inputs) => inputs.map((input, index) => (index + 1) * 1000)
        );

        for (let j = 0; j < familyNames.length; j++) {
          await page.type(`.family-name:nth-of-type(${j + 1})`, familyNames[j]);
          await page.type(
            `.family-occupation:nth-of-type(${j + 1})`,
            familyOccupations[j]
          );
          await page.type(
            `.family-income:nth-of-type(${j + 1})`,
            familyIncomes[j].toString()
          );
        }

        // Total family income
        await page.type("#rm-jum", "10000");

        // Final income
        await page.type(".final-income", "10000");

        // Handle file uploads for ID Card Front and Back
        const idCardFront = path.resolve(__dirname, "test-files", "id-front.jpg");
        const idCardBack = path.resolve(__dirname, "test-files", "id-back.jpg");

        // ID Card Front Upload
        const [fileChooserFront] = await Promise.all([
          page.waitForFileChooser(),
          page.click("#idCardFront"),
        ]);
        await fileChooserFront.accept([idCardFront]);

        // Wait for the cropper modal and simulate crop
        await page.waitForSelector("#cropModal", { visible: true });
        await page.click("#cropButton");

        // ID Card Back Upload
        const [fileChooserBack] = await Promise.all([
          page.waitForFileChooser(),
          page.click("#idCardBack"),
        ]);
        await fileChooserBack.accept([idCardBack]);

        // Wait for the cropper modal and simulate crop
        await page.waitForSelector("#cropModal", { visible: true });
        await page.click("#cropButton");

        // Signature (draw on canvas)
        await page.evaluate(() => {
          const canvas = document.getElementById("signatureCanvas");
          const ctx = canvas.getContext("2d");
          ctx.beginPath();
          ctx.moveTo(20, 20);
          ctx.lineTo(100, 40);
          ctx.stroke();
        });

        // Submit the form
        await page.click(route.formSelector);

        // Wait for success message or response
        await page.waitForSelector(".success-message", { timeout: 15000 });

        console.log(`Form submitted successfully for route: ${route.url}`);
        await page.close();
      } catch (error) {
        console.error(`Error on route ${route.url}:`, error);

        // Replace URL special characters for file naming
        const sanitizedUrl = route.url.replace(/[^a-z0-9]/gi, "_").toLowerCase();
        const screenshotPath = path.join(__dirname, `error-${sanitizedUrl}.png`);

        // Ensure directory exists before saving the screenshot
        fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });

        await page.screenshot({ path: screenshotPath });
        await page.close();
      }
    }
  }

  await browser.close();
  console.log("Test completed.");
}

runTest().catch((err) => console.error("Test failed:", err));
