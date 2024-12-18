const mongoose = require('mongoose');
const Admin = require("./models/admin"); // Admin model

// Replace the connection string with your actual MongoDB URI
const mongoURI = 'mongodb+srv://seekho:admin@cluster0.eqodz2h.mongodb.net/pdf2222';

async function createAdmin() {
    try {
        await mongoose.connect(mongoURI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('Connected to MongoDB.');

        // Customize the email and password as needed
        const adminData = {
            email: 'admin@gmail.com',
            password: '12345678'  // In production, consider hashing this
        };

        const newAdmin = new Admin(adminData);
        await newAdmin.save();
        
        console.log('Admin created successfully:', newAdmin);
    } catch (error) {
        console.error('Error creating admin:', error);
    } finally {
        await mongoose.connection.close();
    }
}

createAdmin();
