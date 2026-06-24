freshcrate-release-file:
  file.managed:
    - name: /opt/freshcrate/release
    - contents: freshcrate-agent-edition

freshcrate-salt-readme:
  file.managed:
    - name: /opt/freshcrate/home/receipts/salt-freshcrate-applied.txt
    - contents: |
        state=freshcrate
        image_lane=agent-edition
        config_mode=salt-local
