require("dotenv").config();
const bcrypt = require("bcryptjs");
const db = require("./db");

const PASSWORD = "Walksync123";
const reset = process.argv.includes("--reset");

const demo = [
  ["Ananya Sharma", "ananya@example.com", "female", "Rajpur Road", "evening", "steady", 4, "Love evening walks and meeting new people."],
  ["Rahul Verma", "rahul@example.com", "male", "Clock Tower", "morning", "brisk", 5, "Morning walker who enjoys fitness and nature."],
  ["Priya Negi", "priya@example.com", "female", "Prem Nagar", "morning", "relaxed", 3, "Enjoys peaceful walks and staying active."],
  ["Arjun Rawat", "arjun@example.com", "male", "Mussoorie Road", "evening", "steady", 6, "Weekend walker and nature lover."],
  ["Meera Kapoor", "meera@example.com", "female", "Race Course", "morning", "steady", 4, "Training for a 10K and happy to chat on the way."],
  ["Kabir Singh", "kabir@example.com", "male", "Sahastradhara Road", "evening", "relaxed", 3, "Unwinding after work with an easy evening stroll."],
  ["Sana Khan", "sana@example.com", "female", "Clement Town", "evening", "brisk", 5, "Brisk walks, podcasts and good conversation."],
  ["Dev Thapa", "dev@example.com", "male", "Rajpur Road", "morning", "steady", 4, "Early riser exploring a new route every week."],
];

if (reset) db.reset();
const store = db.load();
let added = 0;

for (const [name, email, gender, location, time, pace, distanceKm, bio] of demo) {
  if (store.users.some((u) => u.email === email)) continue;
  store.users.push({
    id: db.id(),
    name,
    email,
    gender,
    passwordHash: bcrypt.hashSync(PASSWORD, 10),
    profile: { location, time, pace, distanceKm, bio, available: true },
    createdAt: new Date().toISOString(),
  });
  added++;
}

db.save();
console.log(`Seeded ${added} demo walkers into ${db.FILE}`);
console.log(`Demo login: ananya@example.com / ${PASSWORD}  (all demo accounts share this password)`);
