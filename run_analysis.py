"""Run the energy price shock analysis and output results as JSON for the dashboard."""
from energy_shock import run_full_analysis

if __name__ == "__main__":
    run_full_analysis(output_path="dashboard/src/data/results.json")
