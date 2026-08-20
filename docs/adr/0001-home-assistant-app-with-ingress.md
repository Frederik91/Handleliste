# Run as a Home Assistant App with Ingress

The household runs Home Assistant OS and wants a standalone shared application that still feels native in the Home Assistant sidebar. We will package Handleliste as a Home Assistant App and expose its interface through Ingress, giving it an app-owned backend and storage while relying on Home Assistant authentication and avoiding a separately exposed service.
