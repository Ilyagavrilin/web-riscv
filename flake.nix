{
  description = "SCR1 browser workbench";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    scr1 = {
      url = "github:syntacore/scr1/ebb5e3551a9d93c0ee95f0b767dd878b8927e702";
      flake = false;
    };
  };

  outputs =
    {
      nixpkgs,
      scr1,
      ...
    }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
        "x86_64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      packagesFor =
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          peripheral = pkgs.callPackage ./nix/peripheral.nix { src = ./.; };
          models = nixpkgs.lib.mapAttrs (
            profile: _:
            pkgs.callPackage ./nix/model.nix {
              inherit scr1 profile;
              src = ./.;
            }
          ) (builtins.fromJSON (builtins.readFile ./web/profiles.json));
        in
        {
          pulse-counter = peripheral;
          default = pkgs.callPackage ./nix/site.nix {
            inherit scr1 models peripheral;
            src = ./.;
          };
        }
        // nixpkgs.lib.mapAttrs' (name: value: nixpkgs.lib.nameValuePair "scr1-${name}" value) models;
    in
    {
      packages = forAllSystems packagesFor;
      checks = forAllSystems (system: {
        site = (packagesFor system).default;
      });
      formatter = forAllSystems (system: nixpkgs.legacyPackages.${system}.nixfmt-tree);
      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              cmake
              ninja
              verilator
              emscripten
              nodejs
              python3
              nixfmt
            ];
            SCR1_SOURCE = scr1;
          };
          browser = pkgs.mkShell {
            packages = [ (pkgs.python3.withPackages (p: [ p.playwright ])) ];
            PLAYWRIGHT_BROWSERS_PATH = pkgs.playwright-driver.selectBrowsers {
              withChromium = false;
              withChromiumHeadlessShell = true;
              withFirefox = false;
              withWebkit = false;
              withFfmpeg = false;
            };
          };
        }
      );
    };
}
