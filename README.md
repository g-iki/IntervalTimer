# HIIT Interval Timer

Web-based Interval Timer tailored for HIIT workouts.

## Features
- **Customizable Phases**: Warmup, Workout, Rest, Rounds, Sets, Set Rest, Cooldown.
- **Audio Cues**: Beeps during the last 5 seconds and a distinct sound at the end of each phase.
- **Local Storage**: Automatically saves your settings.
- **Responsive Design**: Works on PC and Smartphone with a premium dark mode interface.
- **Wake Lock**: Prevents screen sleep during workouts (on supported browsers).

## How to Run

1. Ensure you have Node.js installed.
2. Open a terminal in this folder.
3. Run the development server:
   ```bash
   npm run dev
   ```
4. Open the displayed URL (e.g., `http://localhost:5173`) in your browser.

## Settings Guide
- **Warmup**: Time before the first round.
- **Workout**: Duration of the exercise.
- **Rest**: Rest between rounds (skipped on the last round of a set).
- **Rounds**: Number of workout/rest cycles per set.
- **Sets**: Number of round groups.
- **Set Rest**: Rest between sets (skipped on the last set).
- **Cooldown**: Time after the last set.
