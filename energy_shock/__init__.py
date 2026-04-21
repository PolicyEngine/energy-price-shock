"""Distributional analysis of UK energy price shocks, built on PolicyEngine UK.

See :mod:`energy_shock.generate` for the CLI entry point and
:mod:`energy_shock.sections` for the individual analysis sections.
"""

from importlib.metadata import PackageNotFoundError, version

from .generate import run_all, run_all_countries

try:
    __version__ = version("energy-shock")
except PackageNotFoundError:  # package not installed (editable / source run)
    __version__ = "0.0.0+unknown"

__all__ = ["__version__", "run_all", "run_all_countries"]
