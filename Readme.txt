===============================================================================
 UniBite - Campus Food Ordering Platform
 "Your Campus. Your Cravings. One Click."
===============================================================================

Team members : ______________________________   (fill in)
Course       : ______________________________   (fill in)
Source code  : https://github.com/sivanaa111-ship-it/unibite


-------------------------------------------------------------------------------
1. WHAT THE PROJECT IS
-------------------------------------------------------------------------------
UniBite is a web application that lets university students order food from
campus restaurants, cafes and food trucks. It has three user roles:

  * Student          - registers with a university email + University ID,
                       browses restaurants, searches dishes, places orders,
                       tracks order status and rates restaurants.
  * Restaurant Owner - manages their own restaurant's information, menu,
                       incoming orders, and sees ratings and statistics.
  * Super Admin      - separate dashboard (/admin) to add, edit, publish,
                       deactivate and reactivate restaurants, review restaurant
                       applications, invite restaurant owners, manage student
                       and restaurant accounts, and view the audit log.

All data (restaurants, menus, orders, ratings, accounts) is stored in a
database and loaded dynamically. Nothing is hardcoded in the pages.


-------------------------------------------------------------------------------
2. TECHNOLOGIES / PROGRAMMING LANGUAGE
-------------------------------------------------------------------------------
  Language   : JavaScript (ECMAScript 2022)
  Backend    : Node.js with the Express web framework
  Database   : SQLite (built into Node.js through the node:sqlite module;
               no separate database server is needed)
  Frontend   : HTML5, CSS3 and JavaScript (ES modules), served by the backend
  Security   : bcrypt password hashing, signed session cookies (JWT),
               role-based access control, optional two-factor authentication
               for the Super Admin
  Testing    : Node.js built-in test runner (node:test)


-------------------------------------------------------------------------------
3. REQUIRED RUNNING ENVIRONMENT
-------------------------------------------------------------------------------
  Operating system : Windows 10/11, macOS 12+ or Linux
  Runtime          : Node.js version 22.5 or newer (LTS recommended)
                     Download: https://nodejs.org  (choose "LTS")
                     npm is installed automatically with Node.js.
  Web browser      : Google Chrome, Microsoft Edge, Firefox or Safari
                     (a recent version)
  Disk space       : about 50 MB
  Internet         : NOT required to run. The required libraries are already
                     included in the "node_modules" folder. Internet is only
                     used to load the web font; without it the pages fall
                     back to the system font.
  Port             : the application uses port 3000 (http://localhost:3000)

To check that Node.js is installed, open a Command Prompt and type:
      node -v
It must print v22.5.0 or higher (for example v22.12.0 or v24.x).


-------------------------------------------------------------------------------
4. HOW TO COMPILE / BUILD
-------------------------------------------------------------------------------
JavaScript does not need a separate compilation step: Node.js compiles the
code automatically (just-in-time, with the V8 engine) when the program starts.
There is no .exe to build.

The "build" step is only to make sure the libraries are installed. They are
already included in the submitted archive (node_modules folder), so this step
is OPTIONAL. Run it only if the node_modules folder is missing or if you see
an error such as "Cannot find module 'express'":

      npm install

(This step needs an internet connection.)


-------------------------------------------------------------------------------
5. HOW TO RUN THE PROJECT  (step by step, Windows)
-------------------------------------------------------------------------------
  Step 1. Extract the zip archive.

  Step 2. Open the extracted "unibite" folder. It contains package.json,
          and the folders src, public and node_modules.

  Step 3. Open a Command Prompt IN THAT FOLDER:
          click the address bar at the top of the File Explorer window,
          type   cmd   and press Enter.

  Step 4. Create the database with demo data (first time only):

              npm run seed:reset

          It prints the list of demo accounts (see section 6).

  Step 5. Start the server:

              npm start

          Wait for the message:   UniBite running at http://localhost:3000
          Keep this window open while using the website.

  Step 6. Open a web browser and go to:

              http://localhost:3000

  To stop the server, press Ctrl + C in the Command Prompt (or close it).
  Next time, only Step 3 and Step 5 are needed. Your data is kept.

  macOS / Linux: open Terminal, run  cd path/to/unibite , then run the same
  commands as in steps 4 and 5.


-------------------------------------------------------------------------------
6. DEMO ACCOUNTS AND PAGES
-------------------------------------------------------------------------------
After running "npm run seed:reset" the following accounts exist:

  Role               Login page                                Email / Password
  ----------------   ---------------------------------------   ----------------------------------
  Student            http://localhost:3000/student/login       student@unibite.edu / Student12345
  Restaurant Owner   http://localhost:3000/restaurant/login    owner@unibite.edu   / Owner12345
                     (Bean There Cafe)
  Restaurant Owner   http://localhost:3000/restaurant/login    grill@unibite.edu   / Owner12345
                     (The Grill House)
  Super Admin        http://localhost:3000/admin/login         admin@unibite.edu   / SuperAdmin2026

Notes:
  * Students and restaurant owners use the same login page with two tabs:
    "Login as Student" and "Login as Restaurant".
  * The Super Admin can only sign in at /admin/login.
  * To register a NEW student: use an email ending in @unibite.edu and a
    University ID between 20230003 and 20230050 (demo university records).
  * Emails (account verification, owner invitations, password resets) are not
    sent to real inboxes in this demo setup. They can be read at:
        http://localhost:3000/dev/mailbox.html
    Open the email there and click its link (e.g. to verify a new student).

Suggested walkthrough:
  1. Student: log in, open a restaurant, add items to the cart, place an order.
  2. Restaurant: log in as owner@unibite.edu, open "Incoming orders" and
     accept -> prepare -> ready -> picked up. The student sees the status change.
  3. Student: rate the completed order.
  4. Admin: log in at /admin/login, add a restaurant, invite an owner, open the
     invitation from the dev mailbox and activate the owner account.
  5. Admin: deactivate a restaurant. It disappears from the public site, but
     its order history is kept. Reactivate it again.


-------------------------------------------------------------------------------
7. RUNNING THE AUTOMATED TESTS (optional)
-------------------------------------------------------------------------------
      npm test

Runs 16 end-to-end tests (registration, validation, restaurant applications,
approvals, invitations, menu and order management, deactivation and
reactivation, access control, data preservation, account management and
two-factor login) on a temporary database. The real database is not touched.
Expected result:  "# pass 16"  and  "# fail 0".


-------------------------------------------------------------------------------
8. PROJECT STRUCTURE
-------------------------------------------------------------------------------
  unibite/
    package.json            Project information, scripts and dependencies
    Readme.txt              This file
    README.md               Detailed technical documentation
    src/
      server.js             Program entry point (starts the web server)
      app.js                Web application setup, security and page guards
      config.js             Configuration (port, session lifetimes, etc.)
      db/                   Database connection, migrations (schema), demo data
      middleware/           Authentication, roles, CSRF, uploads, errors
      services/             Business logic (restaurants, orders, invitations,
                            email, secure tokens, two-factor auth, etc.)
      routes/               REST API: auth, public, student, restaurant, admin
    public/                 Web pages (HTML, CSS, JavaScript)
      admin/                Super Admin dashboard and login
    scripts/                Server tools (create Super Admin, import roster)
    tests/                  Automated tests
    design-system/          UI design guidelines (colors, fonts)
    data/                   Database file (created by "npm run seed:reset")
    uploads/                Uploaded restaurant and menu images


-------------------------------------------------------------------------------
9. TROUBLESHOOTING
-------------------------------------------------------------------------------
  "'node' is not recognized" / "'npm' is not recognized"
      -> Node.js is not installed. Install the LTS version from nodejs.org,
         then CLOSE and reopen the Command Prompt.

  "Error: listen EADDRINUSE ... 3000"
      -> Another program (or an older UniBite window) is using port 3000.
         Close it, or run:   taskkill /F /IM node.exe   and start again.

  The browser shows "Page not found" for /student/login
      -> An older copy of the project is running. Close all Command Prompt
         windows and start again from THIS folder (section 5).

  "Incorrect email or password" for the demo accounts
      -> Stop the server (Ctrl + C), run   npm run seed:reset , then
         npm start  again. Type the password by hand, because the browser
         may autofill an old saved one.

  "Cannot find module ..."
      -> Run   npm install   (needs internet) and try again.

  Windows "Smart App Control" blocks start-unibite.bat
      -> Do not use the .bat file. Use the Command Prompt steps in section 5.
===============================================================================
