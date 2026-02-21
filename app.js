/**
 * HydraTrack - Gamified Water Reminder App
 * A fun and engaging way to track your daily water intake
 */

// ==================== AWS Configuration ====================
const AWS_CONFIG = {
    API_URL: 'https://p7kjo92mk8.execute-api.us-east-1.amazonaws.com',
    USER_POOL_ID: 'us-east-1_KRGtmJkS7',
    CLIENT_ID: '54nerocjbb2qkk8jricjsbd77e',
    REGION: 'us-east-1'
};

// ==================== Auth Manager ====================
class AuthManager {
    constructor() {
        this.userPool = new AmazonCognitoIdentity.CognitoUserPool({
            UserPoolId: AWS_CONFIG.USER_POOL_ID,
            ClientId: AWS_CONFIG.CLIENT_ID
        });
        this.cognitoUser = null;
        this.pendingEmail = null;
    }

    getCurrentUser() {
        return new Promise((resolve) => {
            const user = this.userPool.getCurrentUser();
            if (!user) return resolve(null);

            user.getSession((err, session) => {
                if (err || !session || !session.isValid()) return resolve(null);
                this.cognitoUser = user;
                resolve({
                    email: user.getUsername(),
                    token: session.getIdToken().getJwtToken()
                });
            });
        });
    }

    signUp(email, password) {
        return new Promise((resolve, reject) => {
            const attributeList = [
                new AmazonCognitoIdentity.CognitoUserAttribute({
                    Name: 'email',
                    Value: email
                })
            ];

            this.userPool.signUp(email, password, attributeList, null, (err, result) => {
                if (err) return reject(err);
                this.pendingEmail = email;
                resolve(result);
            });
        });
    }

    confirmSignUp(email, code) {
        return new Promise((resolve, reject) => {
            const userData = {
                Username: email,
                Pool: this.userPool
            };
            const cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);

            cognitoUser.confirmRegistration(code, true, (err, result) => {
                if (err) return reject(err);
                resolve(result);
            });
        });
    }

    signIn(email, password) {
        return new Promise((resolve, reject) => {
            const authDetails = new AmazonCognitoIdentity.AuthenticationDetails({
                Username: email,
                Password: password
            });

            const userData = {
                Username: email,
                Pool: this.userPool
            };

            const cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);

            cognitoUser.authenticateUser(authDetails, {
                onSuccess: (session) => {
                    this.cognitoUser = cognitoUser;
                    resolve({
                        email: email,
                        token: session.getIdToken().getJwtToken()
                    });
                },
                onFailure: (err) => reject(err)
            });
        });
    }

    signOut() {
        if (this.cognitoUser) {
            this.cognitoUser.signOut();
            this.cognitoUser = null;
        }
        const user = this.userPool.getCurrentUser();
        if (user) user.signOut();
    }

    async getToken() {
        const user = await this.getCurrentUser();
        return user ? user.token : null;
    }
}

// ==================== Sync Manager ====================
class SyncManager {
    constructor(authManager) {
        this.auth = authManager;
        this.syncTimer = null;
        this.isSyncing = false;
    }

    async loadFromCloud() {
        try {
            const token = await this.auth.getToken();
            if (!token) return null;

            const res = await fetch(`${AWS_CONFIG.API_URL}/state`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (res.status === 404) return null;
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (err) {
            console.error('Cloud load failed:', err);
            return null;
        }
    }

    async saveToCloud(state) {
        try {
            this.isSyncing = true;
            const token = await this.auth.getToken();
            if (!token) return false;

            const res = await fetch(`${AWS_CONFIG.API_URL}/state`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(state)
            });

            this.isSyncing = false;
            return res.ok;
        } catch (err) {
            console.error('Cloud save failed:', err);
            this.isSyncing = false;
            return false;
        }
    }

    async deleteFromCloud() {
        try {
            const token = await this.auth.getToken();
            if (!token) return false;

            const res = await fetch(`${AWS_CONFIG.API_URL}/state`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            return res.ok;
        } catch (err) {
            console.error('Cloud delete failed:', err);
            return false;
        }
    }

    debouncedSave(state) {
        clearTimeout(this.syncTimer);
        this.syncTimer = setTimeout(() => {
            this.saveToCloud(state);
        }, 2000);
    }
}
class HydraTrack {
    constructor() {
        // Auth & Cloud Sync
        this.authManager = new AuthManager();
        this.syncManager = new SyncManager(this.authManager);
        this.isAuthenticated = false;
        this.userEmail = null;

        // Game State
        this.state = {
            currentIntake: 0,
            dailyGoal: 2000,
            xp: 0,
            totalXp: 0,
            level: 1,
            streak: 0,
            lastDrinkDate: null,
            history: [],
            achievements: {},
            settings: {
                soundEnabled: true,
                notificationsEnabled: false,
                reminderInterval: 60,
                startTime: '08:00',
                endTime: '22:00'
            },
            stats: {
                totalDays: 0,
                totalWater: 0,
                perfectDays: 0,
                bestStreak: 0,
                glassesCount: 0
            }
        };

        // Level titles and XP requirements
        this.levels = [
            { level: 1, title: 'Hydration Rookie', xpRequired: 0 },
            { level: 2, title: 'Water Apprentice', xpRequired: 100 },
            { level: 3, title: 'Hydration Enthusiast', xpRequired: 250 },
            { level: 4, title: 'Water Warrior', xpRequired: 500 },
            { level: 5, title: 'Hydration Hero', xpRequired: 800 },
            { level: 6, title: 'Aqua Champion', xpRequired: 1200 },
            { level: 7, title: 'Water Master', xpRequired: 1700 },
            { level: 8, title: 'Hydration Legend', xpRequired: 2300 },
            { level: 9, title: 'Aqua Sage', xpRequired: 3000 },
            { level: 10, title: 'Hydration Deity', xpRequired: 4000 }
        ];

        // Achievements definition
        this.achievementsDef = [
            { id: 'first_drop', name: 'First Drop', desc: 'Drink your first glass', icon: '💧', xp: 25, condition: (s) => s.stats.glassesCount >= 1 },
            { id: 'getting_started', name: 'Getting Started', desc: 'Complete your first day', icon: '🌟', xp: 50, condition: (s) => s.stats.perfectDays >= 1 },
            { id: 'hydration_habit', name: 'Hydration Habit', desc: 'Reach a 3-day streak', icon: '🔥', xp: 75, condition: (s) => s.streak >= 3 },
            { id: 'week_warrior', name: 'Week Warrior', desc: 'Reach a 7-day streak', icon: '⚔️', xp: 150, condition: (s) => s.streak >= 7 },
            { id: 'hydration_hero', name: 'Hydration Hero', desc: 'Reach a 14-day streak', icon: '🦸', xp: 300, condition: (s) => s.streak >= 14 },
            { id: 'monthly_master', name: 'Monthly Master', desc: 'Reach a 30-day streak', icon: '👑', xp: 500, condition: (s) => s.streak >= 30 },
            { id: 'liter_club', name: 'Liter Club', desc: 'Drink 1L in one session', icon: '🏆', xp: 50, condition: (s) => s.history.some(h => h.amount >= 1000) },
            { id: 'early_bird', name: 'Early Bird', desc: 'Drink water before 8 AM', icon: '🐦', xp: 40, condition: (s) => s.history.some(h => new Date(h.timestamp).getHours() < 8) },
            { id: 'night_owl', name: 'Night Owl', desc: 'Drink water after 10 PM', icon: '🦉', xp: 40, condition: (s) => s.history.some(h => new Date(h.timestamp).getHours() >= 22) },
            { id: 'ocean_drinker', name: 'Ocean Drinker', desc: 'Drink 10L total', icon: '🌊', xp: 100, condition: (s) => s.stats.totalWater >= 10000 },
            { id: 'river_runner', name: 'River Runner', desc: 'Drink 50L total', icon: '🏞️', xp: 200, condition: (s) => s.stats.totalWater >= 50000 },
            { id: 'waterfall_wonder', name: 'Waterfall Wonder', desc: 'Drink 100L total', icon: '💦', xp: 400, condition: (s) => s.stats.totalWater >= 100000 },
            { id: 'level_5', name: 'Rising Star', desc: 'Reach Level 5', icon: '⭐', xp: 100, condition: (s) => s.level >= 5 },
            { id: 'level_10', name: 'Ultimate Hydrator', desc: 'Reach Level 10', icon: '🌈', xp: 250, condition: (s) => s.level >= 10 },
            { id: 'perfectionist', name: 'Perfectionist', desc: 'Complete 10 perfect days', icon: '💎', xp: 200, condition: (s) => s.stats.perfectDays >= 10 }
        ];

        // Mascot messages
        this.mascotMessages = {
            greeting: [
                "Let's stay hydrated today! 💪",
                "Ready to crush your water goals? 🎯",
                "Your body will thank you! 💧",
                "Time to make some waves! 🌊"
            ],
            encouragement: [
                "Great job! Keep it up! 🌟",
                "You're doing amazing! ⭐",
                "Fantastic progress! 🎉",
                "Your body thanks you! 💙"
            ],
            reminder: [
                "Don't forget to drink water! 💧",
                "Time for a hydration break! ⏰",
                "Your cells need water! 🧬",
                "Stay refreshed, stay focused! 🎯"
            ],
            goalReached: [
                "🎉 You did it! Amazing work!",
                "🏆 Goal crushed! You're a champion!",
                "⭐ Incredible! You're a hydration hero!",
                "🌟 Perfect day achieved! So proud!"
            ],
            lowProgress: [
                "Let's pick up the pace! 💪",
                "You've got this! One sip at a time! 🥤",
                "Remember, small sips add up! 💧",
                "Your future self will thank you! ⏳"
            ]
        };

        // Sound effects (using Web Audio API)
        this.audioContext = null;

        // Reminder timer
        this.reminderTimer = null;

        // Initialize
        this.init();
    }

    init() {
        this.loadState();
        this.checkNewDay();
        this.initializeElements();
        this.initializeEventListeners();
        this.initializeAuth();
        this.updateDisplay();
        this.renderAchievements();
        this.startReminderIfEnabled();
        this.createBackgroundBubbles();

        // Set initial mascot message
        this.setMascotMessage('greeting');

        // Check if user is already signed in
        this.checkExistingSession();
    }

    // ==================== State Management ====================

    loadState() {
        const saved = localStorage.getItem('hydratrack_state');
        if (saved) {
            const parsed = JSON.parse(saved);
            this.state = { ...this.state, ...parsed };
        }
    }

    saveState() {
        localStorage.setItem('hydratrack_state', JSON.stringify(this.state));
        // Sync to cloud if authenticated
        if (this.isAuthenticated) {
            this.syncManager.debouncedSave(this.state);
        }
    }

    checkNewDay() {
        const today = new Date().toDateString();
        const lastDate = this.state.lastDrinkDate;

        if (lastDate && lastDate !== today) {
            // Check if yesterday was completed for streak
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);

            if (lastDate === yesterday.toDateString()) {
                // Continue streak if goal was met yesterday
                const yesterdayIntake = this.getIntakeForDate(yesterday);
                if (yesterdayIntake < this.state.dailyGoal) {
                    this.state.streak = 0;
                }
            } else {
                // Missed a day, reset streak
                this.state.streak = 0;
            }

            // Reset daily intake
            this.state.currentIntake = 0;
        }

        this.saveState();
    }

    getIntakeForDate(date) {
        const dateStr = date.toDateString();
        return this.state.history
            .filter(h => new Date(h.timestamp).toDateString() === dateStr)
            .reduce((sum, h) => sum + h.amount, 0);
    }

    // ==================== DOM Elements ====================

    initializeElements() {
        // Header
        this.streakCount = document.getElementById('streakCount');
        this.settingsBtn = document.getElementById('settingsBtn');

        // Level bar
        this.levelBadge = document.getElementById('levelBadge');
        this.levelTitle = document.getElementById('levelTitle');
        this.xpFill = document.getElementById('xpFill');
        this.xpText = document.getElementById('xpText');

        // Mascot
        this.mascot = document.getElementById('mascot');
        this.mascotText = document.getElementById('mascotText');

        // Progress
        this.currentIntakeEl = document.getElementById('currentIntake');
        this.dailyGoalEl = document.getElementById('dailyGoal');
        this.progressRing = document.getElementById('progressRing');
        this.progressPercentage = document.getElementById('progressPercentage');

        // Challenge
        this.challengeText = document.getElementById('challengeText');
        this.challengeFill = document.getElementById('challengeFill');
        this.challengeStatus = document.getElementById('challengeStatus');

        // Action buttons
        this.actionBtns = document.querySelectorAll('.action-btn');
        this.customAmount = document.getElementById('customAmount');
        this.addCustomBtn = document.getElementById('addCustomBtn');

        // Navigation
        this.navBtns = document.querySelectorAll('.nav-btn');

        // Modals
        this.settingsModal = document.getElementById('settingsModal');
        this.achievementsModal = document.getElementById('achievementsModal');
        this.historyModal = document.getElementById('historyModal');
        this.reminderModal = document.getElementById('reminderModal');

        // Settings inputs
        this.goalInput = document.getElementById('goalInput');
        this.soundToggle = document.getElementById('soundToggle');
        this.notificationToggle = document.getElementById('notificationToggle');

        // Reminder inputs
        this.reminderInterval = document.getElementById('reminderInterval');
        this.startTime = document.getElementById('startTime');
        this.endTime = document.getElementById('endTime');
        this.reminderStatus = document.getElementById('reminderStatus');
        this.toggleRemindersBtn = document.getElementById('toggleReminders');
        this.reminderBtnText = document.getElementById('reminderBtnText');
        this.reminderBtnIcon = document.getElementById('reminderBtnIcon');

        // Popups
        this.achievementPopup = document.getElementById('achievementPopup');
        this.levelupPopup = document.getElementById('levelupPopup');
        this.celebration = document.getElementById('celebration');
        this.xpFloat = document.getElementById('xpFloat');

        // Reminder notification
        this.reminderNotification = document.getElementById('reminderNotification');

        // Toast container
        this.toastContainer = document.getElementById('toastContainer');
    }

    // ==================== Event Listeners ====================

    initializeEventListeners() {
        // Action buttons
        this.actionBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const amount = parseInt(btn.dataset.amount);
                this.addWater(amount);
                this.createRipple(e, btn);
            });
        });

        // Custom amount
        this.addCustomBtn.addEventListener('click', () => {
            const amount = parseInt(this.customAmount.value);
            if (amount > 0 && amount <= 2000) {
                this.addWater(amount);
                this.customAmount.value = '';
            } else {
                this.showToast('⚠️', 'Please enter a valid amount (1-2000ml)');
            }
        });

        this.customAmount.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.addCustomBtn.click();
            }
        });

        // Navigation
        this.navBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.dataset.view;
                this.handleNavigation(view);
            });
        });

        // Settings
        this.settingsBtn.addEventListener('click', () => this.openModal(this.settingsModal));
        document.getElementById('closeSettings').addEventListener('click', () => this.closeModal(this.settingsModal));
        document.getElementById('saveSettings').addEventListener('click', () => this.saveSettings());
        document.getElementById('resetProgress').addEventListener('click', () => this.resetProgress());

        // Achievements
        document.getElementById('closeAchievements').addEventListener('click', () => this.closeModal(this.achievementsModal));

        // History
        document.getElementById('closeHistory').addEventListener('click', () => this.closeModal(this.historyModal));

        // Reminder
        document.getElementById('closeReminder').addEventListener('click', () => this.closeModal(this.reminderModal));
        this.toggleRemindersBtn.addEventListener('click', () => this.toggleReminders());

        // Popups close on click
        this.achievementPopup.addEventListener('click', () => this.closeAchievementPopup());
        this.levelupPopup.addEventListener('click', () => this.closeLevelupPopup());
        document.getElementById('closeCelebration').addEventListener('click', () => this.closeCelebration());

        // Reminder notification
        document.getElementById('reminderQuickAdd').addEventListener('click', () => {
            this.addWater(250);
            this.hideReminderNotification();
        });
        document.getElementById('reminderDismiss').addEventListener('click', () => this.hideReminderNotification());

        // Modal overlay close
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', () => {
                const modal = overlay.closest('.modal');
                this.closeModal(modal);
            });
        });

        // Mascot click
        this.mascot.addEventListener('click', () => {
            this.mascotBounce();
            this.setMascotMessage('encouragement');
        });

        // Load settings into inputs
        this.loadSettingsIntoInputs();
    }

    // ==================== Water Tracking ====================

    addWater(amount) {
        const previousIntake = this.state.currentIntake;
        this.state.currentIntake += amount;

        // Update last drink date
        this.state.lastDrinkDate = new Date().toDateString();

        // Add to history
        this.state.history.push({
            amount: amount,
            timestamp: new Date().toISOString(),
            date: new Date().toDateString()
        });

        // Update stats
        this.state.stats.glassesCount++;
        this.state.stats.totalWater += amount;

        // Calculate XP
        const xpGained = Math.floor(amount / 25); // 10 XP per 250ml
        this.addXP(xpGained);

        // Play sound
        if (this.state.settings.soundEnabled) {
            this.playWaterSound();
        }

        // Show XP float
        this.showXPFloat(xpGained);

        // Update display
        this.updateDisplay();

        // Check for goal achievement
        if (previousIntake < this.state.dailyGoal && this.state.currentIntake >= this.state.dailyGoal) {
            this.handleGoalAchieved();
        }

        // Check for new achievements
        this.checkAchievements();

        // Update mascot
        this.updateMascotMood();

        // Save state
        this.saveState();
    }

    handleGoalAchieved() {
        // Increment streak
        this.state.streak++;
        if (this.state.streak > this.state.stats.bestStreak) {
            this.state.stats.bestStreak = this.state.streak;
        }

        // Increment perfect days
        this.state.stats.perfectDays++;
        this.state.stats.totalDays++;

        // Bonus XP for completing goal
        this.addXP(100);

        // Show celebration
        setTimeout(() => {
            this.showCelebration();
        }, 500);

        // Update mascot message
        this.setMascotMessage('goalReached');
    }

    // ==================== XP & Leveling ====================

    addXP(amount) {
        this.state.xp += amount;
        this.state.totalXp += amount;

        // Check for level up
        this.checkLevelUp();
    }

    checkLevelUp() {
        const currentLevel = this.state.level;
        let newLevel = 1;

        for (let i = this.levels.length - 1; i >= 0; i--) {
            if (this.state.totalXp >= this.levels[i].xpRequired) {
                newLevel = this.levels[i].level;
                break;
            }
        }

        if (newLevel > currentLevel) {
            this.state.level = newLevel;
            this.showLevelUp(currentLevel, newLevel);
            this.checkAchievements();
        }
    }

    getXPForCurrentLevel() {
        const currentLevelData = this.levels.find(l => l.level === this.state.level);
        const nextLevelData = this.levels.find(l => l.level === this.state.level + 1);

        if (!nextLevelData) {
            return { current: 0, required: 1, percentage: 100 };
        }

        const xpIntoCurrentLevel = this.state.totalXp - currentLevelData.xpRequired;
        const xpRequiredForNext = nextLevelData.xpRequired - currentLevelData.xpRequired;

        return {
            current: xpIntoCurrentLevel,
            required: xpRequiredForNext,
            percentage: (xpIntoCurrentLevel / xpRequiredForNext) * 100
        };
    }

    // ==================== Achievements ====================

    checkAchievements() {
        let newAchievements = [];

        this.achievementsDef.forEach(achievement => {
            if (!this.state.achievements[achievement.id] && achievement.condition(this.state)) {
                this.state.achievements[achievement.id] = {
                    unlockedAt: new Date().toISOString()
                };
                newAchievements.push(achievement);
            }
        });

        if (newAchievements.length > 0) {
            // Show first new achievement
            this.showAchievementUnlocked(newAchievements[0]);

            // Add XP for achievements
            newAchievements.forEach(a => {
                this.addXP(a.xp);
            });

            // Show badge dot
            document.getElementById('newBadgeDot').classList.remove('hidden');
        }

        this.renderAchievements();
        this.saveState();
    }

    renderAchievements() {
        const grid = document.getElementById('achievementsGrid');
        if (!grid) return;

        const unlockedCount = Object.keys(this.state.achievements).length;
        document.getElementById('achievementsCount').textContent = `${unlockedCount}/${this.achievementsDef.length}`;

        grid.innerHTML = this.achievementsDef.map(achievement => {
            const isUnlocked = this.state.achievements[achievement.id];
            return `
                <div class="achievement-card ${isUnlocked ? 'unlocked' : 'locked'}">
                    <span class="achievement-card-icon">${achievement.icon}</span>
                    <span class="achievement-card-name">${achievement.name}</span>
                    <span class="achievement-card-desc">${achievement.desc}</span>
                </div>
            `;
        }).join('');
    }

    // ==================== Display Updates ====================

    updateDisplay() {
        // Update progress
        this.currentIntakeEl.textContent = this.state.currentIntake;
        this.dailyGoalEl.textContent = this.state.dailyGoal;

        // Calculate percentage
        const percentage = Math.min((this.state.currentIntake / this.state.dailyGoal) * 100, 100);
        this.progressPercentage.textContent = `${Math.round(percentage)}%`;

        // Update progress ring
        const circumference = 2 * Math.PI * 95; // radius = 95
        const offset = circumference - (percentage / 100) * circumference;
        this.progressRing.style.strokeDashoffset = offset;

        // Update water drops
        this.updateWaterDrops(percentage);

        // Update streak
        this.streakCount.textContent = this.state.streak;

        // Update level
        const levelData = this.levels.find(l => l.level === this.state.level);
        this.levelBadge.textContent = `Lv. ${this.state.level}`;
        this.levelTitle.textContent = levelData ? levelData.title : 'Hydration Master';

        // Update XP bar
        const xpData = this.getXPForCurrentLevel();
        this.xpFill.style.width = `${xpData.percentage}%`;
        this.xpText.textContent = `${xpData.current} / ${xpData.required} XP`;

        // Update challenge
        this.updateChallenge();

        // Update reminder status
        this.updateReminderStatus();
    }

    updateWaterDrops(percentage) {
        const drops = document.querySelectorAll('.drop');
        drops.forEach((drop, index) => {
            const threshold = (index + 1) * 33;
            if (percentage >= threshold) {
                drop.classList.add('active');
            } else {
                drop.classList.remove('active');
            }
        });
    }

    updateChallenge() {
        const glassesToday = Math.floor(this.state.currentIntake / 250);
        const targetGlasses = 8;
        const progress = Math.min((glassesToday / targetGlasses) * 100, 100);

        this.challengeText.textContent = 'Drink 8 glasses of water today!';
        this.challengeFill.style.width = `${progress}%`;
        this.challengeStatus.textContent = `${Math.min(glassesToday, targetGlasses)}/${targetGlasses}`;

        if (glassesToday >= targetGlasses) {
            this.challengeStatus.textContent = '✓ Complete!';
        }
    }

    // ==================== Mascot ====================

    setMascotMessage(type) {
        const messages = this.mascotMessages[type];
        if (messages) {
            const randomMessage = messages[Math.floor(Math.random() * messages.length)];
            this.mascotText.textContent = randomMessage;
        }
    }

    updateMascotMood() {
        const percentage = (this.state.currentIntake / this.state.dailyGoal) * 100;
        const mouth = this.mascot.querySelector('.mascot-mouth');

        if (percentage >= 100) {
            mouth.className = 'mascot-mouth happy';
            this.setMascotMessage('goalReached');
        } else if (percentage >= 50) {
            mouth.className = 'mascot-mouth happy';
            this.setMascotMessage('encouragement');
        } else if (percentage >= 25) {
            mouth.className = 'mascot-mouth happy';
            this.setMascotMessage('encouragement');
        } else {
            mouth.className = 'mascot-mouth happy';
            this.setMascotMessage('lowProgress');
        }
    }

    mascotBounce() {
        this.mascot.style.animation = 'none';
        this.mascot.offsetHeight; // Trigger reflow
        this.mascot.style.animation = 'mascotBob 0.5s ease';
        setTimeout(() => {
            this.mascot.style.animation = 'mascotBob 3s infinite ease-in-out';
        }, 500);
    }

    // ==================== Modals & Popups ====================

    openModal(modal) {
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    closeModal(modal) {
        modal.classList.add('hidden');
        document.body.style.overflow = '';
    }

    handleNavigation(view) {
        // Update active nav button
        this.navBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === view);
        });

        // Handle view
        switch (view) {
            case 'achievements':
                document.getElementById('newBadgeDot').classList.add('hidden');
                this.openModal(this.achievementsModal);
                break;
            case 'history':
                this.renderHistory();
                this.openModal(this.historyModal);
                break;
            case 'reminder':
                this.openModal(this.reminderModal);
                break;
            default:
                // Home - close all modals
                this.closeModal(this.achievementsModal);
                this.closeModal(this.historyModal);
                this.closeModal(this.reminderModal);
        }
    }

    showAchievementUnlocked(achievement) {
        document.getElementById('achievementIcon').textContent = achievement.icon;
        document.getElementById('achievementName').textContent = achievement.name;
        document.getElementById('achievementDesc').textContent = achievement.desc;
        document.getElementById('achievementXP').textContent = `+${achievement.xp} XP`;

        this.achievementPopup.classList.remove('hidden');

        if (this.state.settings.soundEnabled) {
            this.playAchievementSound();
        }

        setTimeout(() => {
            this.closeAchievementPopup();
        }, 3000);
    }

    closeAchievementPopup() {
        this.achievementPopup.classList.add('hidden');
    }

    showLevelUp(oldLevel, newLevel) {
        const newLevelData = this.levels.find(l => l.level === newLevel);

        document.getElementById('oldLevel').textContent = `Lv. ${oldLevel}`;
        document.getElementById('newLevel').textContent = `Lv. ${newLevel}`;
        document.getElementById('newTitle').textContent = newLevelData ? newLevelData.title : 'Hydration Master';

        this.levelupPopup.classList.remove('hidden');

        if (this.state.settings.soundEnabled) {
            this.playLevelUpSound();
        }

        setTimeout(() => {
            this.closeLevelupPopup();
        }, 3000);
    }

    closeLevelupPopup() {
        this.levelupPopup.classList.add('hidden');
    }

    showCelebration() {
        this.celebration.classList.remove('hidden');
        this.createConfetti();

        if (this.state.settings.soundEnabled) {
            this.playCelebrationSound();
        }
    }

    closeCelebration() {
        this.celebration.classList.add('hidden');
    }

    showXPFloat(amount) {
        this.xpFloat.textContent = `+${amount} XP`;
        this.xpFloat.classList.remove('hidden');
        this.xpFloat.style.left = '50%';
        this.xpFloat.style.top = '40%';
        this.xpFloat.style.transform = 'translateX(-50%)';

        // Reset animation
        this.xpFloat.style.animation = 'none';
        this.xpFloat.offsetHeight;
        this.xpFloat.style.animation = 'floatUp 1.5s ease-out forwards';

        setTimeout(() => {
            this.xpFloat.classList.add('hidden');
        }, 1500);
    }

    showToast(icon, message) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerHTML = `
            <span class="toast-icon">${icon}</span>
            <span class="toast-message">${message}</span>
        `;
        this.toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    // ==================== History ====================

    renderHistory() {
        // Update stats
        document.getElementById('totalDays').textContent = this.state.stats.totalDays || this.calculateTotalDays();
        document.getElementById('totalWater').textContent = this.formatWaterAmount(this.state.stats.totalWater);
        document.getElementById('bestStreak').textContent = this.state.stats.bestStreak;
        document.getElementById('perfectDays').textContent = this.state.stats.perfectDays;

        // Render weekly chart
        this.renderWeeklyChart();

        // Render history list
        this.renderHistoryList();
    }

    calculateTotalDays() {
        const dates = new Set(this.state.history.map(h => h.date));
        return dates.size;
    }

    formatWaterAmount(ml) {
        if (ml >= 1000) {
            return `${(ml / 1000).toFixed(1)}L`;
        }
        return `${ml}ml`;
    }

    renderWeeklyChart() {
        const chart = document.getElementById('weeklyChart');
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const today = new Date();
        let chartHTML = '';
        let weeklyData = [];

        for (let i = 6; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = date.toDateString();

            const intake = this.state.history
                .filter(h => h.date === dateStr)
                .reduce((sum, h) => sum + h.amount, 0);

            weeklyData.push({
                date: date,
                day: days[date.getDay()],
                intake: intake,
                percentage: Math.min((intake / this.state.dailyGoal) * 100, 100),
                isToday: i === 0,
                isComplete: intake >= this.state.dailyGoal
            });
        }

        // Calculate trend
        const weekTotal = weeklyData.reduce((sum, d) => sum + d.intake, 0);
        const weekAverage = Math.round(weekTotal / 7);
        const daysComplete = weeklyData.filter(d => d.isComplete).length;

        chartHTML = `
            <div class="chart-summary">
                <div class="chart-stat">
                    <span class="chart-stat-value">${this.formatWaterAmount(weekTotal)}</span>
                    <span class="chart-stat-label">This Week</span>
                </div>
                <div class="chart-stat">
                    <span class="chart-stat-value">${this.formatWaterAmount(weekAverage)}</span>
                    <span class="chart-stat-label">Daily Avg</span>
                </div>
                <div class="chart-stat">
                    <span class="chart-stat-value">${daysComplete}/7</span>
                    <span class="chart-stat-label">Goals Met</span>
                </div>
            </div>
            <div class="chart-bars">
        `;

        weeklyData.forEach(data => {
            const barClass = data.isToday ? 'today' : (data.isComplete ? 'complete' : '');
            chartHTML += `
                <div class="chart-bar" title="${data.intake}ml">
                    <span class="bar-value">${data.intake > 0 ? this.formatWaterAmount(data.intake) : '-'}</span>
                    <div class="bar-container">
                        <div class="bar-fill ${barClass}" style="height: ${Math.max(data.percentage, 3)}%"></div>
                        ${data.isComplete ? '<span class="bar-check">✓</span>' : ''}
                    </div>
                    <span class="bar-label">${data.day}</span>
                </div>
            `;
        });

        chartHTML += '</div>';

        // Add trend indicator
        const firstHalf = weeklyData.slice(0, 3).reduce((sum, d) => sum + d.intake, 0);
        const secondHalf = weeklyData.slice(4).reduce((sum, d) => sum + d.intake, 0);
        const trend = secondHalf > firstHalf ? 'up' : (secondHalf < firstHalf ? 'down' : 'stable');
        const trendIcon = trend === 'up' ? '📈' : (trend === 'down' ? '📉' : '➡️');
        const trendText = trend === 'up' ? 'Improving!' : (trend === 'down' ? 'Keep it up!' : 'Staying steady');

        chartHTML += `
            <div class="chart-trend">
                <span class="trend-icon">${trendIcon}</span>
                <span class="trend-text">${trendText}</span>
            </div>
        `;

        chart.innerHTML = chartHTML;
    }

    renderHistoryList() {
        const list = document.getElementById('historyList');

        // Group history by date
        const groupedHistory = this.state.history.reduce((groups, entry) => {
            const date = entry.date;
            if (!groups[date]) {
                groups[date] = [];
            }
            groups[date].push(entry);
            return groups;
        }, {});

        // Sort dates in reverse chronological order
        const sortedDates = Object.keys(groupedHistory).sort((a, b) =>
            new Date(b) - new Date(a)
        ).slice(0, 7); // Show last 7 days

        if (sortedDates.length === 0) {
            list.innerHTML = '<p style="text-align: center; color: var(--text-muted);">No water logged yet. Start tracking!</p>';
            return;
        }

        let html = '';
        const today = new Date().toDateString();
        const yesterday = new Date(Date.now() - 86400000).toDateString();

        sortedDates.forEach(date => {
            const entries = groupedHistory[date];
            const totalAmount = entries.reduce((sum, e) => sum + e.amount, 0);
            const goalPercent = Math.round((totalAmount / this.state.dailyGoal) * 100);
            const isComplete = totalAmount >= this.state.dailyGoal;

            // Format date label
            let dateLabel = date;
            if (date === today) dateLabel = 'Today';
            else if (date === yesterday) dateLabel = 'Yesterday';
            else dateLabel = new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

            html += `
                <div class="history-day">
                    <div class="history-day-header">
                        <div class="history-day-info">
                            <span class="history-day-date">${dateLabel}</span>
                            <span class="history-day-entries">${entries.length} drinks</span>
                        </div>
                        <div class="history-day-stats">
                            <span class="history-day-total ${isComplete ? 'complete' : ''}">${totalAmount}ml</span>
                            <span class="history-day-percent ${isComplete ? 'complete' : ''}">${goalPercent}% ${isComplete ? '✓' : ''}</span>
                        </div>
                    </div>
                    <div class="history-day-bar">
                        <div class="history-day-fill ${isComplete ? 'complete' : ''}" style="width: ${Math.min(goalPercent, 100)}%"></div>
                    </div>
                </div>
            `;
        });

        list.innerHTML = html;
    }

    // ==================== Settings ====================

    loadSettingsIntoInputs() {
        this.goalInput.value = this.state.dailyGoal;
        this.soundToggle.checked = this.state.settings.soundEnabled;
        this.notificationToggle.checked = this.state.settings.notificationsEnabled;
        this.reminderInterval.value = this.state.settings.reminderInterval;
        this.startTime.value = this.state.settings.startTime;
        this.endTime.value = this.state.settings.endTime;
    }

    saveSettings() {
        const newGoal = parseInt(this.goalInput.value);
        if (newGoal >= 500 && newGoal <= 5000) {
            this.state.dailyGoal = newGoal;
        }

        this.state.settings.soundEnabled = this.soundToggle.checked;
        this.state.settings.notificationsEnabled = this.notificationToggle.checked;

        this.saveState();
        this.updateDisplay();
        this.closeModal(this.settingsModal);
        this.showToast('✅', 'Settings saved!');
    }

    resetProgress() {
        if (confirm('Are you sure you want to reset ALL progress? This cannot be undone!')) {
            localStorage.removeItem('hydratrack_state');
            if (this.isAuthenticated) {
                this.syncManager.deleteFromCloud();
            }
            location.reload();
        }
    }

    // ==================== Authentication ====================

    initializeAuth() {
        this.authModal = document.getElementById('authModal');
        this.authBtn = document.getElementById('authBtn');

        // Auth button in header
        this.authBtn.addEventListener('click', () => {
            if (this.isAuthenticated) {
                this.handleSignOut();
            } else {
                this.openModal(this.authModal);
            }
        });

        // Close auth modal
        document.getElementById('closeAuth').addEventListener('click', () => this.closeModal(this.authModal));

        // Auth tabs
        document.getElementById('tabSignIn').addEventListener('click', () => this.switchAuthTab('signin'));
        document.getElementById('tabSignUp').addEventListener('click', () => this.switchAuthTab('signup'));

        // Sign In
        document.getElementById('signInBtn').addEventListener('click', () => this.handleSignIn());
        document.getElementById('signInPassword').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleSignIn();
        });

        // Sign Up
        document.getElementById('signUpBtn').addEventListener('click', () => this.handleSignUp());
        document.getElementById('signUpPassword').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleSignUp();
        });

        // Confirm
        document.getElementById('confirmBtn').addEventListener('click', () => this.handleConfirm());
        document.getElementById('confirmCode').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleConfirm();
        });

        // Modal overlay close
        this.authModal.querySelector('.modal-overlay').addEventListener('click', () => this.closeModal(this.authModal));
    }

    async checkExistingSession() {
        try {
            const user = await this.authManager.getCurrentUser();
            if (user) {
                this.isAuthenticated = true;
                this.userEmail = user.email;
                this.updateAuthUI();

                // Load cloud data
                const cloudState = await this.syncManager.loadFromCloud();
                if (cloudState) {
                    // Use cloud data if it has more progress
                    if ((cloudState.totalXp || 0) > (this.state.totalXp || 0) ||
                        (cloudState.stats?.totalWater || 0) > (this.state.stats?.totalWater || 0)) {
                        this.state = { ...this.state, ...cloudState };
                        this.saveStateLocal();
                        this.updateDisplay();
                        this.renderAchievements();
                    }
                }
                this.showToast('☁️', 'Synced with cloud');
            }
        } catch (err) {
            console.error('Session check failed:', err);
        }
    }

    saveStateLocal() {
        localStorage.setItem('hydratrack_state', JSON.stringify(this.state));
    }

    switchAuthTab(tab) {
        const tabs = document.querySelectorAll('.auth-tab');
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tab));

        document.getElementById('signInForm').classList.toggle('hidden', tab !== 'signin');
        document.getElementById('signUpForm').classList.toggle('hidden', tab !== 'signup');
        document.getElementById('confirmForm').classList.add('hidden');

        // Clear errors
        document.querySelectorAll('.auth-error').forEach(e => e.classList.add('hidden'));

        // Update title
        document.getElementById('authModalTitle').textContent = tab === 'signin' ? '🔐 Sign In' : '✨ Sign Up';
    }

    showAuthError(formId, message) {
        const errorEl = document.getElementById(formId);
        errorEl.textContent = message;
        errorEl.classList.remove('hidden');
    }

    async handleSignUp() {
        const email = document.getElementById('signUpEmail').value.trim();
        const password = document.getElementById('signUpPassword').value;

        if (!email || !password) {
            this.showAuthError('signUpError', 'Please fill in all fields');
            return;
        }

        try {
            document.getElementById('signUpBtn').textContent = '⏳ Creating...';
            await this.authManager.signUp(email, password);

            // Show confirm form
            document.getElementById('signInForm').classList.add('hidden');
            document.getElementById('signUpForm').classList.add('hidden');
            document.getElementById('confirmForm').classList.remove('hidden');
            document.getElementById('authModalTitle').textContent = '📬 Verify Email';
            document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        } catch (err) {
            this.showAuthError('signUpError', err.message || 'Sign up failed');
        } finally {
            document.getElementById('signUpBtn').textContent = '✨ Create Account';
        }
    }

    async handleConfirm() {
        const code = document.getElementById('confirmCode').value.trim();
        const email = this.authManager.pendingEmail;

        if (!code) {
            this.showAuthError('confirmError', 'Please enter the verification code');
            return;
        }

        try {
            document.getElementById('confirmBtn').textContent = '⏳ Verifying...';
            await this.authManager.confirmSignUp(email, code);
            this.showToast('✅', 'Email verified! Please sign in.');
            this.switchAuthTab('signin');
            document.getElementById('signInEmail').value = email;
        } catch (err) {
            this.showAuthError('confirmError', err.message || 'Verification failed');
        } finally {
            document.getElementById('confirmBtn').textContent = '✅ Verify & Sign In';
        }
    }

    async handleSignIn() {
        const email = document.getElementById('signInEmail').value.trim();
        const password = document.getElementById('signInPassword').value;

        if (!email || !password) {
            this.showAuthError('signInError', 'Please fill in all fields');
            return;
        }

        try {
            document.getElementById('signInBtn').textContent = '⏳ Signing in...';
            const user = await this.authManager.signIn(email, password);

            this.isAuthenticated = true;
            this.userEmail = user.email;
            this.updateAuthUI();
            this.closeModal(this.authModal);

            // Load cloud data and merge
            const cloudState = await this.syncManager.loadFromCloud();
            if (cloudState) {
                if ((cloudState.totalXp || 0) > (this.state.totalXp || 0) ||
                    (cloudState.stats?.totalWater || 0) > (this.state.stats?.totalWater || 0)) {
                    this.state = { ...this.state, ...cloudState };
                    this.updateDisplay();
                    this.renderAchievements();
                }
            }
            // Upload current state to cloud
            await this.syncManager.saveToCloud(this.state);
            this.saveStateLocal();

            this.showToast('🎉', `Welcome, ${email.split('@')[0]}!`);
        } catch (err) {
            this.showAuthError('signInError', err.message || 'Sign in failed');
        } finally {
            document.getElementById('signInBtn').textContent = '🚀 Sign In';
        }
    }

    handleSignOut() {
        if (confirm('Sign out? Your data is saved to the cloud.')) {
            this.authManager.signOut();
            this.isAuthenticated = false;
            this.userEmail = null;
            this.updateAuthUI();
            this.showToast('👋', 'Signed out');
        }
    }

    updateAuthUI() {
        const btn = document.getElementById('authBtn');
        if (this.isAuthenticated) {
            const name = this.userEmail.split('@')[0];
            const displayName = name.length > 10 ? name.substring(0, 10) + '…' : name;
            btn.textContent = `☁️ ${displayName}`;
            btn.classList.add('signed-in');
            btn.title = `Signed in as ${this.userEmail}. Click to sign out.`;
        } else {
            btn.textContent = '👤 Sign In';
            btn.classList.remove('signed-in');
            btn.title = 'Sign In';
        }
    }

    // ==================== Reminders ====================

    toggleReminders() {
        if (this.state.settings.notificationsEnabled) {
            this.disableReminders();
        } else {
            this.enableReminders();
        }
    }

    async enableReminders() {
        // Request notification permission
        if ('Notification' in window) {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                this.showToast('⚠️', 'Please enable notifications in your browser settings');
                return;
            }
        }

        this.state.settings.notificationsEnabled = true;
        this.state.settings.reminderInterval = parseInt(this.reminderInterval.value);
        this.state.settings.startTime = this.startTime.value;
        this.state.settings.endTime = this.endTime.value;

        this.startReminder();
        this.saveState();
        this.updateReminderStatus();
        this.showToast('🔔', 'Reminders enabled!');
    }

    disableReminders() {
        this.state.settings.notificationsEnabled = false;
        this.stopReminder();
        this.saveState();
        this.updateReminderStatus();
        this.showToast('🔕', 'Reminders disabled');
    }

    startReminderIfEnabled() {
        if (this.state.settings.notificationsEnabled) {
            this.startReminder();
        }
    }

    startReminder() {
        this.stopReminder();

        const intervalMs = this.state.settings.reminderInterval * 60 * 1000;

        this.reminderTimer = setInterval(() => {
            if (this.isWithinActiveHours()) {
                this.sendReminder();
            }
        }, intervalMs);

        // Show reminder active indicator
        document.getElementById('reminderActive').classList.remove('hidden');
    }

    stopReminder() {
        if (this.reminderTimer) {
            clearInterval(this.reminderTimer);
            this.reminderTimer = null;
        }
        document.getElementById('reminderActive').classList.add('hidden');
    }

    isWithinActiveHours() {
        const now = new Date();
        const currentTime = now.getHours() * 60 + now.getMinutes();

        const [startHour, startMin] = this.state.settings.startTime.split(':').map(Number);
        const [endHour, endMin] = this.state.settings.endTime.split(':').map(Number);

        const startMinutes = startHour * 60 + startMin;
        const endMinutes = endHour * 60 + endMin;

        return currentTime >= startMinutes && currentTime <= endMinutes;
    }

    sendReminder() {
        // In-app notification
        this.showReminderNotification();

        // Browser notification
        if ('Notification' in window && Notification.permission === 'granted') {
            const notification = new Notification('💧 Time to Hydrate!', {
                body: `You've had ${this.state.currentIntake}ml today. Keep going!`,
                icon: '💧',
                badge: '💧',
                tag: 'hydration-reminder',
                requireInteraction: false
            });

            notification.onclick = () => {
                window.focus();
                notification.close();
            };

            setTimeout(() => notification.close(), 10000);
        }

        // Play reminder sound
        if (this.state.settings.soundEnabled) {
            this.playReminderSound();
        }
    }

    showReminderNotification() {
        this.reminderNotification.classList.remove('hidden');
        this.setMascotMessage('reminder');

        setTimeout(() => {
            this.hideReminderNotification();
        }, 30000);
    }

    hideReminderNotification() {
        this.reminderNotification.classList.add('hidden');
    }

    updateReminderStatus() {
        const statusWrapper = this.reminderStatus.querySelector('.status-icon-wrapper');
        const statusText = this.reminderStatus.querySelector('.status-text');

        if (this.state.settings.notificationsEnabled) {
            statusWrapper.className = 'status-icon-wrapper on';
            statusWrapper.querySelector('.status-icon').textContent = '🔔';
            statusText.textContent = `Reminding every ${this.state.settings.reminderInterval} minutes`;
            this.reminderBtnIcon.textContent = '🔕';
            this.reminderBtnText.textContent = 'Disable Reminders';
        } else {
            statusWrapper.className = 'status-icon-wrapper off';
            statusWrapper.querySelector('.status-icon').textContent = '🔕';
            statusText.textContent = 'Reminders are off';
            this.reminderBtnIcon.textContent = '🔔';
            this.reminderBtnText.textContent = 'Enable Reminders';
        }
    }

    // ==================== Sounds ====================

    initAudioContext() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        return this.audioContext;
    }

    playTone(frequency, duration, type = 'sine') {
        try {
            const ctx = this.initAudioContext();
            const oscillator = ctx.createOscillator();
            const gainNode = ctx.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(ctx.destination);

            oscillator.frequency.value = frequency;
            oscillator.type = type;

            gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

            oscillator.start(ctx.currentTime);
            oscillator.stop(ctx.currentTime + duration);
        } catch (e) {
            console.log('Audio not available');
        }
    }

    playWaterSound() {
        this.playTone(800, 0.1);
        setTimeout(() => this.playTone(1000, 0.1), 100);
        setTimeout(() => this.playTone(1200, 0.15), 200);
    }

    playAchievementSound() {
        this.playTone(523, 0.15);
        setTimeout(() => this.playTone(659, 0.15), 150);
        setTimeout(() => this.playTone(784, 0.2), 300);
        setTimeout(() => this.playTone(1047, 0.3), 450);
    }

    playLevelUpSound() {
        const notes = [523, 587, 659, 698, 784, 880, 988, 1047];
        notes.forEach((note, i) => {
            setTimeout(() => this.playTone(note, 0.15), i * 80);
        });
    }

    playCelebrationSound() {
        this.playLevelUpSound();
        setTimeout(() => {
            this.playTone(1047, 0.3);
            this.playTone(1319, 0.3);
            this.playTone(1568, 0.4);
        }, 700);
    }

    playReminderSound() {
        this.playTone(880, 0.2);
        setTimeout(() => this.playTone(880, 0.2), 300);
    }

    // ==================== Visual Effects ====================

    createRipple(event, button) {
        const ripple = button.querySelector('.btn-ripple');
        if (!ripple) return;

        const rect = button.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const x = event.clientX - rect.left - size / 2;
        const y = event.clientY - rect.top - size / 2;

        ripple.style.width = ripple.style.height = `${size}px`;
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;

        ripple.classList.remove('animate');
        ripple.offsetHeight; // Trigger reflow
        ripple.classList.add('animate');
    }

    createConfetti() {
        const container = document.getElementById('confetti');
        container.innerHTML = '';

        const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#dfe6e9', '#fd79a8', '#a29bfe'];

        for (let i = 0; i < 100; i++) {
            const confetti = document.createElement('div');
            confetti.className = 'confetti';
            confetti.style.left = `${Math.random() * 100}%`;
            confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
            confetti.style.animationDelay = `${Math.random() * 2}s`;
            confetti.style.animationDuration = `${2 + Math.random() * 2}s`;
            container.appendChild(confetti);
        }
    }

    createBackgroundBubbles() {
        const container = document.getElementById('bgBubbles');
        if (!container) return;

        for (let i = 0; i < 10; i++) {
            const bubble = document.createElement('div');
            bubble.className = 'bubble';
            bubble.style.cssText = `
                position: absolute;
                border-radius: 50%;
                background: rgba(255, 255, 255, ${0.03 + Math.random() * 0.05});
                width: ${50 + Math.random() * 150}px;
                height: ${50 + Math.random() * 150}px;
                left: ${Math.random() * 100}%;
                top: ${Math.random() * 100}%;
                animation: float ${15 + Math.random() * 10}s infinite ease-in-out;
                animation-delay: ${-Math.random() * 20}s;
            `;
            container.appendChild(bubble);
        }
    }
}

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
    window.hydraTrack = new HydraTrack();
});

// Handle visibility change
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && window.hydraTrack) {
        window.hydraTrack.checkNewDay();
        window.hydraTrack.updateDisplay();
    }
});

// Service Worker for PWA (basic offline support)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        // Service worker can be added for PWA functionality
        // navigator.serviceWorker.register('/sw.js');
    });
}
