// Sin consola en Windows al compilar en release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    selyh_agent_lib::run()
}
