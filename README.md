# SkyShards

[🌐 Live App](https://skyshards.com/)

SkyShards is a website for the Hypixel Skyblock attribute fusion system.

## Features
- Calculate the fastest/cheapest way to fuse attributes
- Automatic adjustment of fusion tree based on custom rates and current bazaar prices
- Clean and responsive design

## Getting Started
To run locally:
```sh
pnpm install
pnpm run dev
```

## Solving locally
The greenhouse calculator can use a solver running on your own computer instead of the public
API: open the **Local solver** panel in the calculator, download the package
([SkyShards-Solver](https://github.com/Campionnn/SkyShards-Solver), AGPL-3.0), run `start.bat`
or `start.sh`, and turn on **Solve on this computer**. The site then talks to
`http://127.0.0.1:8765` (port configurable). When developing, `pnpm run dev` works the same way;
the local solver allows the Vite dev origin.

## Contributing
Contributions are welcome! Feel free to open issues or submit pull requests.
