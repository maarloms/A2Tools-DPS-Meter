// Fork: loads the timer module. An inline <script> would need its own hash in
// the CSP; a file from 'self' does not. timer.js stays outside the Vite bundle
// (vite.config.ts), so it is imported at runtime.
import(/* @vite-ignore */ "/fork/timer.js");
